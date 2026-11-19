import {readWechatCloudConfig,saveWechatCloudConfig} from './wechatCloudConfig';

/** Portable, opt-in encrypted WeChat browser identity transfer.
 * Never includes backend secrets or cloud AI API keys.
 */
const encoder=new TextEncoder(),decoder=new TextDecoder();
const identityPrefix='claudia-wechat-anon-v1:';
const magic='claudia-wechat-portable-v1';
const b64=(bytes:Uint8Array)=>btoa(Array.from(bytes,x=>String.fromCharCode(x)).join(''));
const from64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function validSession(value:unknown):value is {access_token:string;refresh_token:string;expires_at:number}{
 if(!value||typeof value!=='object')return false;
 const v=value as Record<string,unknown>;
 return typeof v.access_token==='string'&&v.access_token.length>20&&typeof v.refresh_token==='string'&&v.refresh_token.length>20&&typeof v.expires_at==='number'&&Number.isFinite(v.expires_at);
}
async function keyFor(password:string,salt:Uint8Array,usage:KeyUsage[]){
 if(password.length<12)throw Error('迁移密码至少需要 12 个字符。');
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt as BufferSource,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);
}
export async function exportWechatIdentity(password:string):Promise<Blob>{
 const config=readWechatCloudConfig();
 if(!config)throw Error('本机没有微信 Supabase 配置。');
 const raw=localStorage.getItem(identityPrefix+config.url);
 // A missing anonymous session must not block export of the saved Supabase URL/key.
 let session:unknown;
 try{session=raw?JSON.parse(raw):undefined;}catch{session=undefined;}
 if(!validSession(session))session=undefined;
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await keyFor(password,salt,['encrypt']);
 const data=encoder.encode(JSON.stringify({config,session}));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:encoder.encode(magic)},key,data);
 return new Blob([JSON.stringify({format:magic,kdf:'PBKDF2-SHA256',iterations:600000,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(encrypted))})],{type:'application/json'});
}
export async function inspectWechatIdentity(file:File,password:string):Promise<{config:{url:string;publishableKey:string};session?:{access_token:string;refresh_token:string;expires_at:number}}>{
 if(file.size>32768)throw Error('微信身份迁移文件过大，已拒绝读取。');
 let data:unknown;
 try{data=JSON.parse(await file.text());}catch{throw Error('微信身份迁移文件无效。');}
 if(!data||typeof data!=='object')throw Error('迁移文件结构无效。');
 const item=data as Record<string,unknown>;
 if(item.format!==magic||item.kdf!=='PBKDF2-SHA256'||item.iterations!==600000||
    typeof item.salt!=='string'||typeof item.iv!=='string'||typeof item.ciphertext!=='string')throw Error('不支持此迁移文件。');
 let salt:Uint8Array,iv:Uint8Array,cipher:Uint8Array;
 try{salt=from64(item.salt);iv=from64(item.iv);cipher=from64(item.ciphertext);}catch{throw Error('迁移文件编码无效。');}
 if(salt.length!==16||iv.length!==12||cipher.length<16)throw Error('迁移文件密文结构无效。');
 const key=await keyFor(password,salt,['decrypt']);
 let decoded:unknown;
 try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:encoder.encode(magic)},key,cipher as BufferSource);decoded=JSON.parse(decoder.decode(plain));}
 catch{throw Error('密码错误或迁移文件损坏，未修改本机配置。');}
 if(!decoded||typeof decoded!=='object')throw Error('迁移内容无效。');
 const payload=decoded as Record<string,unknown>;
 if(!payload.config||typeof payload.config!=='object'||(payload.session!==undefined&&!validSession(payload.session)))throw Error('迁移内容不完整。');
 const {validateWechatCloudConfig}=await import('./wechatCloudConfig');
 const config=validateWechatCloudConfig(payload.config as {url:string;publishableKey:string});
 return {config,session:validSession(payload.session)?payload.session:undefined};
}
export async function importWechatIdentity(file:File,password:string):Promise<void>{
 const {config,session}=await inspectWechatIdentity(file,password);
 const current=readWechatCloudConfig();
 if(current&&current.url!==config.url)throw Error('本机已连接不同 Supabase 项目；请先人工确认并清除旧配置。');
 if(session&&localStorage.getItem(identityPrefix+config.url))throw Error('本机已有微信身份，拒绝覆盖。请先在原设备核对绑定。');
 // Save identity first and public config second; rollback on storage failure.
 const slot=identityPrefix+config.url;
 try{if(session)localStorage.setItem(slot,JSON.stringify(session));saveWechatCloudConfig(config);}
 catch(error){if(session)localStorage.removeItem(slot);throw error;}
}
