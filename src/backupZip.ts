import { BackupError, backupLimits, checkAbort, ensure } from "./backupFormat";
import { createBackup, readBackup, type BackupExport, type BackupProgress } from "./backupService";
import type { Entry, FileEntry } from "@zip.js/zip.js";
export const zipLimits = { archiveBytes:32*1024*1024, unpackedBytes:32*1024*1024, entryBytes:8*1024*1024, entries:256, directoryBytes:256*1024, chunkBytes:256*1024, ratio:100 } as const;
const infoName="backup-info.json";
const options={useWebWorkers:false,useCompressionStream:false,chunkSize:zipLimits.chunkBytes};
interface ZipInfo { format:"claudia-phone-zip"; version:1; encryption:"none"|"winzip-aes-256"; payloadFormat:"claudia-phone-backup"; encryptionParameters?: { cipher:"AES-256-CTR"; kdf:"PBKDF2-HMAC-SHA1"; iterations:1000; authentication:"HMAC-SHA1-80" } }
export function checkZipSize(size:number) {ensure(Number.isSafeInteger(size)&&size>0&&size<=zipLimits.archiveBytes,"单个 ZIP 最大支持32 MiB。较大备份请使用高级选项中的原格式工具；没有生成不完整文件。");}
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
    for await(const e of reader.getEntriesGenerator()){checkAbort(signal);checkEntry(e);ensure(entries.length<zipLimits.entries&&!entries.some(x=>x.filename===e.filename),"ZIP 文件过多或文件名重复。");total+=e.uncompressedSize;ensure(total<=zipLimits.unpackedBytes,"ZIP 解压总量超过32 MiB，已停止。");entries.push(e as FileEntry);}
    const meta=entries.find(e=>e.filename===infoName);ensure(meta&&!meta.encrypted&&meta.uncompressedSize<=4096,"ZIP 缺少有效的备份格式说明。");
    let info:ZipInfo;try{info=JSON.parse(await(await extract(meta,undefined,signal)).text());}catch(e){if(e instanceof BackupError)throw e;throw new BackupError("ZIP 备份格式说明已损坏。");}
    ensure(info.format==='claudia-phone-zip'&&info.version===1&&info.payloadFormat==='claudia-phone-backup'&&['none','winzip-aes-256'].includes(info.encryption),"ZIP 备份版本暂不支持，未丢弃未知数据。");
    const payload=entries.filter(e=>e!==meta);ensure(payload.length>=1&&payload.every(e=>e.encrypted===(info.encryption==='winzip-aes-256')),"ZIP 加密状态不一致。");return {reader,entries:payload,info};
  }catch(e){await reader.close();throw e;}
}
export async function inspectBackupZip(file:File,signal?:AbortSignal) {
  try{const value=await open(file,signal);try{return {encrypted:value.info.encryption!=='none'};}finally{await value.reader.close();}}catch(e){throw zipError(e,signal);}
}
function zipError(e:unknown,signal?:AbortSignal):BackupError {
  checkAbort(signal);if(e instanceof BackupError)return e;
  return new BackupError("ZIP 读取失败：文件可能损坏，或密码错误。请检查文件和密码后重试；当前数据未被覆盖。");
}
export async function readBackupZip(file:File,password?:string,signal?:AbortSignal) {
  try{
    const value=await open(file,signal);
    try{
      ensure(value.info.encryption==='none'||!!password,"请填写备份密码。");const files:File[]=[];
      for(const e of value.entries){checkAbort(signal);files.push(await extract(e,password,signal));}
      const manifests=files.filter(f=>f.name.endsWith('.manifest.json'));ensure(manifests.length===1,"ZIP 缺少唯一的备份清单。");
      let m:any;try{m=JSON.parse(await manifests[0].text());}catch{throw new BackupError("ZIP 内备份清单无法解析。");}
      ensure(Array.isArray(m.parts)&&m.parts.length<=zipLimits.entries-2,"ZIP 备份文件列表无效。");
      const names=[manifests[0].name,...m.parts.map((p:any)=>p.name)];ensure(new Set(names).size===names.length&&names.every(n=>typeof n==='string'&&safeName(n))&&files.length===names.length&&files.every(f=>names.includes(f.name)),"ZIP 内文件缺失、重复或包含未知数据，未执行恢复。");
      return files;
    }finally{await value.reader.close();}
  }catch(e){throw zipError(e,signal);}
}
export async function packBackupZip(snapshot:BackupExport,password?:string,signal?:AbortSignal,onProgress?:(p:BackupProgress)=>void) {
  if(password!==undefined)ensure(password.length>=12&&password.length<=1024,"加密密码需12–1024个字符。");
  ensure(snapshot.manifest.credentials==='excluded'&&!snapshot.manifest.encryption,"ZIP 主流程不包含 API 凭据；包含凭据的旧备份请使用原格式工具。");
  const manifest=new Blob([JSON.stringify(snapshot.manifest)],{type:'application/json'});
  ensure(manifest.size<=backupLimits.manifestBytes&&snapshot.manifest.parts.length+2<=zipLimits.entries,"备份信息超过单文件安全限制，请使用原格式工具。");
  const estimated=manifest.size+snapshot.manifest.parts.reduce((s,p)=>s+p.bytes,0)+65536;checkZipSize(estimated);checkAbort(signal);
  const {ZipWriter,BlobReader}=await import('@zip.js/zip.js');const chunks:Blob[]=[];let size=0;
  const sink=new WritableStream<Uint8Array>({write(chunk){checkAbort(signal);size+=chunk.byteLength;checkZipSize(size);chunks.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));}});
  const writer=new ZipWriter(sink,{...options,level:0,zip64:false});
  const info:ZipInfo={format:'claudia-phone-zip',version:1,encryption:password?'winzip-aes-256':'none',payloadFormat:'claudia-phone-backup',...(password?{encryptionParameters:{cipher:'AES-256-CTR' as const,kdf:'PBKDF2-HMAC-SHA1' as const,iterations:1000 as const,authentication:'HMAC-SHA1-80' as const}}:{})};
  try{
    await writer.add(infoName,new BlobReader(new Blob([JSON.stringify(info)])),{signal});
    const settings={signal,password,encryptionStrength:3 as const,zipCrypto:false};
    await writer.add(`${snapshot.manifest.backupId}.manifest.json`,new BlobReader(manifest),settings);
    for(const p of snapshot.manifest.parts){checkAbort(signal);const blob=await snapshot.readPart(p.index);ensure(blob.size===p.bytes,"备份内部数据不完整，未生成 ZIP。");await writer.add(p.name,new BlobReader(blob),settings);onProgress?.({phase:'正在打包',bytes:size,records:p.index+1});}
    await writer.close();checkAbort(signal);checkZipSize(size);return new File(chunks,`Claudia-Phone-Backup-${new Date().toISOString().slice(0,10)}.zip`,{type:'application/zip'});
  }catch(e){chunks.length=0;checkAbort(signal);if(e instanceof BackupError)throw e;throw new BackupError("ZIP 打包未完成，可能是内存或存储空间不足。没有生成不完整备份，请使用原格式工具重试。");}
}
export async function createZipBackup(options:{closedOtherClients:boolean;password?:string;signal?:AbortSignal;onProgress?:(p:BackupProgress)=>void}) {
  const snapshot=await createBackup({closedOtherClients:options.closedOtherClients,signal:options.signal,onProgress:options.onProgress});
  try{return await packBackupZip(snapshot,options.password,options.signal,options.onProgress);}finally{await snapshot.dispose();}
}
export async function verifyZipBackup(file:File,password?:string,signal?:AbortSignal) {
  const files=await readBackupZip(file,password,signal);const result=await readBackup(files,{mode:'verify',signal});return {files,result};
}
