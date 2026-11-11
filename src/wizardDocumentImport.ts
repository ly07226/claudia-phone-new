import {BlobReader,ZipReader,TextWriter} from '@zip.js/zip.js';
import {parseWizardFile,wizardLimits} from './scriptWizardDraft';

/** DOCX is a ZIP of XML parts; read only the main document, never execute macros or HTML. */
export async function readWizardDocument(file:File):Promise<{synopsis?:string;title?:string;rules?:string;direction?:string;longBody?:string}>{
 if(file.size>2*1024*1024)throw Error('文件超过 2 MB，请拆分后导入。');
 if(!/\.docx$/i.test(file.name)){const body=await file.text();if(/\.(txt|md)$/i.test(file.name)&&body.length>wizardLimits.synopsis){if(body.length>500000)throw Error('正文超过 500000 字符，请拆分。');return {longBody:body};}return parseWizardFile(file.name,body);}
 const zip=new ZipReader(new BlobReader(file));
 try{
  const entries=await zip.getEntries();
  const entry=entries.find(e=>e.filename==='word/document.xml');
  if(!entry||!('getData' in entry)||!entry.getData)throw Error('不是有效的 DOCX 文件，找不到正文。');
  const xml=await entry.getData(new TextWriter());
  if(xml.length>4000000)throw Error('Word 正文过大，请拆分后导入。');
  const document=new DOMParser().parseFromString(xml,'application/xml');
  if(document.querySelector('parsererror'))throw Error('Word 正文格式异常。');
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs=Array.from(document.getElementsByTagNameNS(ns,'p'));
  const text=paragraphs.map(p=>Array.from(p.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent??'').join('')).join('\n').trim();
  if(!text)throw Error('Word 文档没有可读取的正文文字。扫描图片中的文字暂不支持。');
  return text.length>wizardLimits.synopsis?{longBody:text}:parseWizardFile(file.name.replace(/\.docx$/i,'.txt'),text);
 }finally{await zip.close();}
}
