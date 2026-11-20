import {exportWechatIdentity,importWechatIdentity,inspectWechatIdentity} from './wechatIdentityTransfer';
import { BackupError, backupLimits, checkAbort, ensure, withBackupPhase } from "./backupFormat";
import { createBackup, readBackup, type BackupExport, type BackupProgress } from "./backupService";
import type { Entry, FileEntry } from "@zip.js/zip.js";
export const zipLimits = { archiveBytes:1024*1024*1024, unpackedBytes:2*1024*1024*1024, entryBytes:8*1024*1024, entries:1024, directoryBytes:1024*1024, chunkBytes:256*1024, ratio:1000 } as const;
const infoName="backup-info.json";
const wechatName="wechat-identity.encrypted.json";
const options={useWebWorkers:false,useCompressionStream:false,chunkSize:zipLimits.chunkBytes};
// Keep the legacy ZIP reader path available for historical archives while the
// streaming importer is introduced. Archive format versions 1–3 remain accepted.
export const supportedBackupZipVersions = [1,2,3] as const;
interface ZipInfo { format:"claudia-phone-zip"; version:1|2|3; encryption:"none"|"winzip-aes-256"|"aes-gcm-backup"; payloadFormat:"claudia-phone-backup"; encryptionParameters?: {cipher:string;kdf:string;iterations:number;authentication:string} }
export function checkZipSize(size:number) {ensure(Number.isSafeInteger(size)&&size>0&&size<=zipLimits.archiveBytes,"单个 ZIP 最大支持1024 MiB。较大备份请使用高级选项中的原格式工具；没有生成不完整文件。");}
function safeName(name:string) {return name.length>0&&name.length<=180&&/^[a-zA-Z0-9_.-]+$/.test(name)&&!name.includes("..");}
/** Bound central directory allocation before invoking a standards-compliant ZIP parser. */
async function preflight(file:File,signal?:AbortSignal) {
  checkZipSize(file.size);checkAbort(signal);
  const magic=new DataView(await file.slice(0,4).arrayBuffer());ensure(magic.byteLength===4&&magic.getUint32(0,true)===0x04034b50,"这不是受支持的 ZIP 备份文件。");
  const tail=new DataView(await file.slice(Math.max(0,file.size-65557)).arrayBuffer());let found=false;
  for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50&&i+22+tail.getUint16(i+20,true)===tail.byteLength){
    const count=tail.getUint16(i+10,true),bytes=tail.getUint32(i+12,true),offset=tail.getUint32(i+16,true);
    ensure(tail.getUint16(i+4,true)===0&&tail.getUint16(i+6,true)===0&&tail.getUint16(i+8,true)===count&&count>0&&count<=zipLimits.entries&&bytes<=zipLimits.directoryBytes&&offset+bytes<=file.size,"ZIP 文件数量、目录大小或结构超出安全限制；不支持分拆 ZIP 或 ZIP64。");found=true;break;
  }
  ensure(found,"ZIP 目录缺失或文件已损坏。");checkAbort(signal);
}
function checkEntry(e:Entry) {
  ensure(safeName(e.filename)&&!e.directory&&!e.symlink&&!e.executable,"ZIP 包含不安全路径、目录或链接，已拒绝读取。");
  ensure(Number.isSafeInteger(e.uncompressedSize)&&e.uncompressedSize>=0&&e.uncompressedSize<=zipLimits.entryBytes&&Number.isSafeInteger(e.compressedSize)&&e.compressedSize>=0,"ZIP 内文件大小超出安全限制。");
  ensure(e.uncompressedSize<=Math.max(1,e.compressedSize)*zipLimits.ratio,"ZIP 压缩比例异常，已拒绝解压。");
  ensure(!e.encrypted||(e.extraFieldAES?.strength===3&&[1,2].includes(e.extraFieldAES.vendorVersion??0)),"ZIP 加密强度或格式不受支持，仅接受标准 AES-256。");
  ensure(!e.zipCrypto,"不支持不安全的旧式 ZIP 密码格式，请使用应用生成的 AES 备份。");
}
async function extract(e:FileEntry,password:string|undefined,signal?:AbortSignal) {
  const chunks:Blob[]= [];let size=0;
  const sink=new WritableStream<Uint8Array>({write(chunk){checkAbort(signal);size+=chunk.byteLength;ensure(size<=e.uncompressedSize&&size<=zipLimits.entryBytes,"ZIP 解压数据超过声明大小或安全限制。");chunks.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));}});
  await e.getData(sink,{...options,password,signal,checkSignature:true,checkOverlappingEntry:true});
  ensure(size===e.uncompressedSize,"ZIP 内文件不完整。");return new File(chunks,e.filename,{type:e.filename.endsWith('.json')?'application/json':'application/octet-stream'});
}
async function open(file:File,signal?:AbortSignal) {
  await preflight(file,signal);const {ZipReader,BlobReader}=await import('@zip.js/zip.js');
  const reader=new ZipReader(new BlobReader(file),options);const entries:FileEntry[]=[];let total=0;
  try{
    for await(const e of reader.getEntriesGenerator()){checkAbort(signal);checkEntry(e);ensure(entries.length<zipLimits.entries&&!entries.some(x=>x.filename===e.filename),"ZIP 文件过多或文件名重复。");total+=e.uncompressedSize;ensure(total<=zipLimits.unpackedBytes,"ZIP 解压总量超过2048 MiB，已停止。");entries.push(e as FileEntry);}
    const meta=entries.find(e=>e.filename===infoName);ensure(meta&&!meta.encrypted&&meta.uncompressedSize<=4096,"ZIP 缺少有效的备份格式说明。");
    let info:ZipInfo;try{info=JSON.parse(await(await extract(meta,undefined,signal)).text());}catch(e){if(e instanceof BackupError)throw e;throw new BackupError("ZIP 备份格式说明已损坏。");}
    ensure(info.format==='claudia-phone-zip'&&info.payloadFormat==='claudia-phone-backup'&&((info.version===1&&['none','winzip-aes-256'].includes(info.encryption))||([2,3].includes(info.version)&&info.encryption==='aes-gcm-backup')),"ZIP 备份版本暂不支持，未丢弃未知数据。");
    const payload=entries.filter(e=>e!==meta);ensure(payload.length>=1&&payload.every(e=>e.encrypted===(info.encryption==='winzip-aes-256')),"ZIP 加密状态不一致。");return {reader,entries:payload,info};
  }catch(e){await reader.close();throw e;}
}
export async function inspectBackupZip(file:File,signal?:AbortSignal) {
  try{const value=await open(file,signal);try{return {encrypted:value.info.encryption!=='none',version:value.info.version,encryption:value.info.encryption};}finally{await value.reader.close();}}catch(e){throw zipError(e,signal);}
}
function zipError(e:unknown,signal?:AbortSignal):BackupError {
  checkAbort(signal);if(e instanceof BackupError)return e;
  if(e instanceof Error&&['Invalid password','Invalid signature','Invalid CRC32'].includes(e.message))return new BackupError(e.message==='Invalid CRC32'?'ZIP 内容校验失败，文件可能不完整或已被修改；未执行恢复。':'加密 ZIP 密码校验或认证未通过，无法区分密码错误与文件损坏；未执行恢复。','ZIP_INTEGRITY');
  return withBackupPhase(e,'zip-read');
}
/** Lazily extracts one ZIP member at a time. Compatible with historical ZIP versions 1–3.
 * Call close() in finally; no extracted members are retained by this reader. */
export async function openStreamingBackupZip(file:File,signal?:AbortSignal) {
  const opened=await open(file,signal);
  const entries=new Map(opened.entries.map(e=>[e.filename,e]));
  let closed=false;
  return {
    version:opened.info.version,
    names:[...entries.keys()],
    async read(name:string,password?:string) {
      ensure(!closed,'ZIP 读取器已关闭。');
      const entry=entries.get(name);
      ensure(!!entry,'ZIP 内缺少请求的数据文件。');
      return extract(entry,password,signal);
    },
    async close(){if(!closed){closed=true;await opened.reader.close();}}
  };
}
export async function readBackupZip(file:File,password?:string,signal?:AbortSignal) {
  try{
    const value=await open(file,signal);
    try{
      ensure(value.info.encryption==='none'||!!password,"请填写备份密码。");const files:File[]=[];
      for(const e of value.entries){checkAbort(signal);files.push(await extract(e,password,signal));}
      const portable=files.filter(f=>f.name===wechatName);
      ensure((value.info.version===3&&portable.length===1)||(value.info.version!==3&&portable.length===0),'微信身份附件缺失或与备份版本不匹配。');
      if(portable.length){ensure(!!password,'请填写微信身份备份密码。');await inspectWechatIdentity(portable[0],password);}
      const backupFiles=files.filter(f=>f.name!==wechatName);
      const manifests=backupFiles.filter(f=>f.name.endsWith('.manifest.json'));ensure(manifests.length===1,"ZIP 缺少唯一的备份清单。");
      let m:any;try{m=JSON.parse(await manifests[0].text());}catch{throw new BackupError("ZIP 内备份清单无法解析。");}
      ensure(value.info.encryption!=='aes-gcm-backup'||(m.credentials==='encrypted'&&m.encryption?.algorithm==='AES-GCM'&&m.encryption?.kdf==='PBKDF2-SHA256'&&m.encryption?.iterations===600000),"ZIP 声明的加密保护与内部数据不一致，已拒绝读取。");
      ensure(Array.isArray(m.parts)&&m.parts.length<=zipLimits.entries-2-portable.length,"ZIP 备份文件列表无效。");
      const names=[manifests[0].name,...m.parts.map((p:any)=>p.name)];ensure(new Set(names).size===names.length&&names.every(n=>typeof n==='string'&&safeName(n))&&backupFiles.length===names.length&&backupFiles.every(f=>names.includes(f.name)),"ZIP 内文件缺失、重复或包含未知数据，未执行恢复。");
      return backupFiles;
    }finally{await value.reader.close();}
  }catch(e){throw zipError(e,signal);}
}
export async function packBackupZip(snapshot:BackupExport,password?:string,signal?:AbortSignal,onProgress?:(p:BackupProgress)=>void,portableWechat?:Blob) {
  if(password!==undefined)ensure(password.length>=12&&password.length<=1024,"加密密码需12–1024个字符。");
  ensure(snapshot.manifest.credentials!=='encrypted'||(!!password&&!!snapshot.manifest.encryption),"加密备份缺少必要的解密凭据。");
  const manifest=new Blob([JSON.stringify(snapshot.manifest)],{type:'application/json'});
  ensure(manifest.size<=backupLimits.manifestBytes&&snapshot.manifest.parts.length+2+(portableWechat?1:0)<=zipLimits.entries,"备份信息超过单文件安全限制，请使用原格式工具。");
  // The archive ceiling applies to the compressed output, not the uncompressed input.
  // Enforce it incrementally in the ZIP sink below, allowing compressible backups.
  checkAbort(signal);
  const {ZipWriter,BlobReader}=await import('@zip.js/zip.js');const chunks:Blob[]=[];let size=0;
  const sink=new WritableStream<Uint8Array>({write(chunk){checkAbort(signal);size+=chunk.byteLength;checkZipSize(size);chunks.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));}});
  const writer=new ZipWriter(sink,{...options,level:6,zip64:false});
  const inner=snapshot.manifest.credentials==='encrypted';
  const info:ZipInfo={format:'claudia-phone-zip',version:portableWechat?3:inner?2:1,encryption:inner?'aes-gcm-backup':password?'winzip-aes-256':'none',payloadFormat:'claudia-phone-backup',...(inner?{encryptionParameters:{cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:600000,authentication:'GCM-128 + HMAC-SHA256'}}:password?{encryptionParameters:{cipher:'AES-256-CTR',kdf:'PBKDF2-HMAC-SHA1',iterations:1000,authentication:'HMAC-SHA1-80'}}:{})};
  try{
    await writer.add(infoName,new BlobReader(new Blob([JSON.stringify(info)])),{signal});
    const settings={signal,password:inner?undefined:password,encryptionStrength:3 as const,zipCrypto:false};
    await writer.add(`${snapshot.manifest.backupId}.manifest.json`,new BlobReader(manifest),settings);
    for(const p of snapshot.manifest.parts){checkAbort(signal);const blob=await snapshot.readPart(p.index);ensure(blob.size===p.bytes,"备份内部数据不完整，未生成 ZIP。");await writer.add(p.name,new BlobReader(blob),settings);onProgress?.({phase:'正在打包',bytes:size,records:p.index+1});}
    if(portableWechat){ensure(inner&&!!password,'微信身份只能加入加密 ZIP。');ensure(portableWechat.size<=32768,'微信身份附件超出安全限制。');await writer.add(wechatName,new BlobReader(portableWechat),settings);}
    await writer.close();checkAbort(signal);checkZipSize(size);return new File(chunks,`Claudia-Phone-Backup-${new Date().toISOString().slice(0,10)}.zip`,{type:'application/zip'});
  }catch(e){chunks.length=0;checkAbort(signal);if(e instanceof BackupError)throw e;throw withBackupPhase(e,'zip-pack');}
}
export async function createZipBackup(options:{closedOtherClients:boolean;includeCredentials?:boolean;credentialConsent?:boolean;database?:import("dexie").default;password?:string;signal?:AbortSignal;onProgress?:(p:BackupProgress)=>void;onWarning?:(message:string)=>void}) {
  if(typeof WritableStream!=='function'||typeof File!=='function'||typeof Blob!=='function')throw new BackupError('当前浏览器缺少 ZIP 所需的文件或流能力，请使用支持的 Safari 版本；没有省略任何数据。','CAPABILITY');
  // Never silently omit an existing WeChat cloud identity from a full encrypted backup.
  const portableWechat=options.includeCredentials?await exportWechatIdentity(options.password||'').catch(e=>{if(e instanceof Error&&e.message==='本机没有微信 Supabase 配置。')return undefined;throw e;}):undefined;
  const snapshot=await createBackup({database:options.database,closedOtherClients:options.closedOtherClients,includeCredentials:options.includeCredentials,credentialConsent:options.credentialConsent,password:options.password,signal:options.signal,onProgress:options.onProgress});
  let completed:File|undefined;
  try{try{completed=await packBackupZip(snapshot,options.password,options.signal,options.onProgress,portableWechat);return completed;}catch(e){throw withBackupPhase(e,'zip-pack');}}
  finally{try{await snapshot.dispose();}catch(e){if(completed)options.onWarning?.(withBackupPhase(e,'export-cleanup').message);/* Never replace a primary failure or discard a complete ZIP because temp cleanup failed. */}}
}
export async function verifyZipBackup(file:File,password?:string,signal?:AbortSignal) {
  const files=await readBackupZip(file,password,signal);const result=await readBackup(files,{mode:'verify',password,signal});return {files,result};
}

/** Invoke only after the main database restore has been committed successfully. */
export async function restoreWechatFromBackupZip(file:File,password:string,signal?:AbortSignal){
 const opened=await open(file,signal);
 try{
  const entry=opened.entries.find(e=>e.filename===wechatName);
  if(!entry)return false;
  ensure(opened.info.version===3&&opened.info.encryption==='aes-gcm-backup','微信身份附件未受完整备份加密保护。');
  const portable=await extract(entry,password,signal);
  // Require a complete, authenticated main archive before touching localStorage.
  const {result}=await verifyZipBackup(file,password,signal);
  try{
   ensure(result.report.status==='verified'&&result.report.recordDigestsMatch&&result.report.referencesValid,'主备份校验失败，拒绝单独恢复微信身份。');
   await importWechatIdentity(portable,password);
  }finally{await result.dispose();}
  return true;
 }finally{await opened.reader.close();}
}
