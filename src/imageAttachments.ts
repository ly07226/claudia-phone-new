import type Dexie from 'dexie';
import type {Asset} from './store';
import type {Message,ContextImage} from './chatTypes';
export const imageLimits={count:3,inputBytes:15*1024*1024,storedBytes:1.5*1024*1024,edge:1600,requestChars:8*1024*1024};
const dataPattern=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function attachmentIds(message:Pick<Message,'attachments'>):string[]{
  if(message.attachments===undefined)return [];
  if(!Array.isArray(message.attachments)||message.attachments.length>imageLimits.count||message.attachments.some(a=>!a||typeof a.assetId!=='string'||!a.assetId)||new Set(message.attachments.map(a=>a.assetId)).size!==message.attachments.length)throw Error('图片附件引用无效。');
  return message.attachments.map(a=>a.assetId);
}
export async function attachmentImages(d:Dexie,message:Pick<Message,'attachments'>):Promise<ContextImage[]>{
  const result:ContextImage[]=[];
  for(const id of attachmentIds(message)){
    const asset=await d.table('assets').get(id);
    if(!asset||asset.type!=='chat-image'||typeof asset.data!=='string'||!dataPattern.test(asset.data)||asset.data.length>imageLimits.storedBytes*4/3+100)throw Error('图片资源缺失或损坏，未向模型发送不完整附件。');
    result.push({mimeType:asset.data.slice(5,asset.data.indexOf(';')),data:asset.data} as ContextImage);
  }
  return result;
}
export interface PreparedImage extends Asset {notice:string}
export async function prepareImage(file:File):Promise<PreparedImage>{
  if(file.size>imageLimits.inputBytes)throw Error('原图超过15MB，请先缩小后选择。');
  const h=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const mime=h[0]===255&&h[1]===216&&h[2]===255?'image/jpeg':h[0]===137&&h[1]===80&&h[2]===78&&h[3]===71?'image/png':String.fromCharCode(...h.slice(0,4))==='RIFF'&&String.fromCharCode(...h.slice(8,12))==='WEBP'?'image/webp':null;
  if(!mime)throw Error('仅支持 JPEG、PNG、WebP。HEIC 等格式请先转换；未上传任何文件。');
  const url=URL.createObjectURL(file),img=new Image();
  try{
    await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error('无法读取图片，请选择有效图片。'));img.src=url;});
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>32*1024*1024)throw Error('图片像素过大（上限32MP），请先缩小。');
    let data:string,notice='',outW=img.naturalWidth,outH=img.naturalHeight;
    if(Math.max(img.naturalWidth,img.naturalHeight)<=imageLimits.edge&&file.size<=imageLimits.storedBytes){
      data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as string);r.onerror=()=>reject(Error('图片读取失败。'));r.readAsDataURL(new Blob([file],{type:mime}));});
    }else{
      const scale=Math.min(1,imageLimits.edge/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=c.getContext('2d');if(!ctx)throw Error('此环境无法压缩图片，请先缩小图片。');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
      outW=c.width;outH=c.height;data=c.toDataURL('image/jpeg',.85);notice=`已压缩为 ${c.width}×${c.height} JPEG（质量85%，透明背景转白色），请确认预览。`;
    }
    if(!dataPattern.test(data)||data.length>imageLimits.storedBytes*4/3+100)throw Error('图片处理后仍超过1.5MB，请自行裁小；没有降低到更低画质。');
    return {id:crypto.randomUUID(),type:'chat-image',data,createdAt:Date.now(),width:outW,height:outH,notice};
  }finally{img.src='';URL.revokeObjectURL(url);}
}
export function attachmentError(error:unknown){return (error as {name?:string})?.name==='QuotaExceededError'?'本地存储空间不足，图片未保存；已输入内容仍保留。':error instanceof Error?error.message:'图片操作失败，请重试。';}
