import {db} from './store';
export interface Sticker {id:string;label:string;group:string;data:string;createdAt:number;lastUsed?:number;favorite?:boolean;archived?:boolean}
const key='sticker-library';
const limit=5*1024*1024;
export async function listStickers():Promise<Sticker[]>{
 const row=await db.themes.get(key);
 return (row?.stickers??[]).filter(r=>!r.archived);
}
export async function updateStickers(change:(rows:Sticker[])=>Sticker[]){
 return db.transaction('rw',db.themes,async()=>{
  const row=await db.themes.get(key);
  const old=row?.stickers??[];
  const active=change(old.filter(r=>!r.archived));
  const ids=new Set(active.map(r=>r.id));
  const stickers=[...active,...old.filter(r=>!ids.has(r.id)).map(r=>({...r,archived:true}))];
  await db.themes.put({id:key,color:'',font:'',iconStyle:'rounded',opacity:0,blur:0,...row,stickers});
  return active;
 });
}
export async function prepareSticker(blob:Blob,label:string,group:string):Promise<Sticker>{
 if(!blob.size||blob.size>limit)throw Error('表情包必须小于5MB');
 const h=new Uint8Array(await blob.slice(0,16).arrayBuffer());
 const ascii=(a:number,b:number)=>String.fromCharCode(...h.slice(a,b));
 const mime=h[0]===255&&h[1]===216&&h[2]===255?'image/jpeg':h[0]===137&&ascii(1,4)==='PNG'?'image/png':/^GIF8[79]a$/.test(ascii(0,6))?'image/gif':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':null;
 if(!mime)throw Error('仅支持 PNG、JPEG、GIF、WebP');
 const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('读取失败'));r.readAsDataURL(new Blob([blob],{type:mime}));});
 const img=new Image();img.src=data;await img.decode();
 if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>16000000)throw Error('图片尺寸过大');
 return {id:crypto.randomUUID(),label:label.trim().slice(0,100)||'表情包',group:group.trim().slice(0,40)||'默认',data,createdAt:Date.now()};
}
export async function importStickerUrl(value:string,group:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('请输入 HTTPS 图片地址');
 const res=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
 if(!res.ok||!res.body)throw Error('图片下载失败');
 const reader=res.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('图片超过5MB');chunks.push(new Uint8Array(value));}}finally{await reader.cancel().catch(()=>{});}
 return prepareSticker(new Blob(chunks),decodeURIComponent(url.pathname.split('/').pop()||'表情包'),group);
}

export async function getSticker(id:string){return (await db.themes.get(key))?.stickers?.find(r=>r.id===id)}
export function parseSticker(text:string){const m=/^\[表情包:([0-9a-f-]{36}):([^\[\]\r\n]{1,100})\]$/i.exec(text.trim());return m?{id:m[1],label:m[2]}:null;}
