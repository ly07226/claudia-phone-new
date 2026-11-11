import {BlobReader,ZipReader,TextWriter} from '@zip.js/zip.js';
import {parseWizardFile,wizardLimits} from './scriptWizardDraft';
/** Original bytes are archived once; extracted text is never silently shortened. */
export async function archiveWizardFile(file:File){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return {mime:file.type||'application/octet-stream',base64:btoa(binary)};}
export async function readWizardDocument(file:File):Promise<{synopsis?:string;title?:string;rules?:string;direction?:string;longBody?:string}>{
 if(file.size>wizardLimits.fileBytes)throw Error('文件超过 20 MB，未导入或截断原文。');
 if(!/\.(docx|txt|md|json)$/i.test(file.name))throw Error('仅支持 DOCX、TXT、MD 或已验证的 JSON。');
 if(!/\.docx$/i.test(file.name)){
  const bytes=new Uint8Array(await file.arrayBuffer());let body:string;
  try{body=new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(bytes);}catch{throw Error('文本编码无法完整读取，请使用 UTF-8 或带 BOM 的 UTF-16，未替换原草稿。');}
  if(!body.trim()||body.length>2000000)throw Error('正文为空或超过 200 万字符，未截断。');
  return /\.json$/i.test(file.name)?{...parseWizardFile(file.name,body),longBody:body}:{longBody:body};
 }
 const zip=new ZipReader(new BlobReader(file));
 try{
  const entries=await zip.getEntries(),parts=entries.filter(e=>/^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(e.filename));
  if(!parts.some(e=>e.filename==='word/document.xml'))throw Error('不是有效的 DOCX 文件，找不到正文。');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';let text='',total=0;
  for(const entry of parts.sort((a,b)=>a.filename==='word/document.xml'?-1:b.filename==='word/document.xml'?1:a.filename.localeCompare(b.filename))){
   total+=entry.uncompressedSize??0;if(total>32*1024*1024)throw Error('Word 解压文字超过 32 MB，未导入。');
   if(!('getData' in entry)||!entry.getData)throw Error('Word 文字分卷无法读取。');const xml=await entry.getData(new TextWriter());if(xml.length>32*1024*1024)throw Error('Word 文字过大。');
   const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('Word 文字格式异常。');
   const walk=(node:Node):string=>{if(node instanceof Element&&node.namespaceURI===ns){if(['t','delText'].includes(node.localName))return node.textContent??'';if(node.localName==='tab')return '\t';if(['br','cr'].includes(node.localName))return '\n';}let result=Array.from(node.childNodes).map(walk).join('');if(node instanceof Element&&node.namespaceURI===ns&&node.localName==='p')result+='\n';return result;};
   text+=(text&&entry.filename!=='word/document.xml'?`\n[${entry.filename}]\n`:'')+walk(doc);
   if(text.length>2000000)throw Error('Word 正文超过 200 万字符，未截断。');
  }
  if(!text.trim())throw Error('Word 没有可读文字；图片内文字暂不支持。');return {longBody:text};
 }finally{await zip.close();}
}
