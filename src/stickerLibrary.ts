import {db} from './store';
export interface Sticker {id:string;label:string;group:string;data:string;createdAt:number;lastUsed?:number;favorite?:boolean;archived?:boolean}
export type StickerMeta=Omit<Sticker,'data'>;
const limit=5*1024*1024;
export async function listStickerMeta():Promise<StickerMeta[]>{return (await db.stickerMeta.toArray()).filter(r=>!r.archived);}
export async function listStickers():Promise<Sticker[]>{return db.transaction('r',db.stickerMeta,db.stickerImages,async()=>{const rows=await listStickerMeta();const images=await db.stickerImages.bulkGet(rows.map(r=>r.id));return rows.flatMap((r,i)=>images[i]?[{...r,data:images[i]!.data}]:[]);});}
export async function updateStickers(change:(rows:Sticker[])=>Sticker[]){
 return db.transaction('rw',db.stickerMeta,db.stickerImages,async()=>{
 const old=await listStickers(),active=change(old),previous=new Map(old.map(r=>[r.id,r])),ids=new Set(active.map(r=>r.id));
 for(const row of active){const {data,...meta}=row;const prior=previous.get(row.id);if(!prior||prior.data!==data)await db.stickerImages.put({id:row.id,data});await db.stickerMeta.put(meta);}
 for(const row of old)if(!ids.has(row.id))await db.stickerMeta.update(row.id,{archived:true});
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
export async function importStickerUrl(value:string,group:string,label?:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('请输入 HTTPS 图片地址');
 let res:Response;
 try{res=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});}
 catch{if(!['i.postimg.cc','i.imgur.com'].includes(url.hostname))throw Error('该图床限制跨域下载，请保存图片后从图库导入');res=await fetch('/api/sticker-image?url='+encodeURIComponent(url.href),{credentials:'omit',signal:AbortSignal.timeout(15000)});}
 if(!res.ok||!res.body)throw Error('图片下载失败');
 const reader=res.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('图片超过5MB');chunks.push(new Uint8Array(value));}}finally{await reader.cancel().catch(()=>{});}
 return prepareSticker(new Blob(chunks),label||decodeURIComponent(url.pathname.split('/').pop()||'表情包'),group);
}

export async function getSticker(id:string){return db.transaction('r',db.stickerMeta,db.stickerImages,async()=>{const meta=await db.stickerMeta.get(id),image=await db.stickerImages.get(id);return meta&&image?{...meta,data:image.data}:undefined;})}
export function parseSticker(text:string){const m=/^\[表情包:([0-9a-f-]{36}):([^\[\]\r\n]{1,100})\]$/i.exec(text.trim());return m?{id:m[1],label:m[2]}:null;}

export function parseStickerUrls(input:string){return input.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()).map(line=>{const match=/^(.*?)\s*(https:\/\/\S+)\s*$/i.exec(line.trim());if(!match)return {url:line.trim(),label:''};return {url:match[2],label:match[1].replace(/[：:；;\s]+$/,'').trim()};});}

export async function saveSticker(row:Sticker){const {data,...meta}=row;await db.transaction('rw',db.stickerMeta,db.stickerImages,async()=>{await db.stickerImages.add({id:row.id,data});await db.stickerMeta.add(meta);});}
export async function patchSticker(id:string,patch:Partial<Pick<StickerMeta,'label'|'group'|'favorite'|'lastUsed'|'archived'>>){await db.stickerMeta.update(id,patch);}
