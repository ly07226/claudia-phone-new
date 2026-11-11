import {libraryLimits} from './library';
import {defaults,initial,validData,type PhaseData} from './engine';
// Separate from all chat, theme, credential and memory records. No database upgrade.
export const storageKey=(database:string)=>`claudia.phasePlay.v1:${database}`;
export function loadPhaseData(database:string):{data:PhaseData;error:string}{
 const settings=defaults(),fallback:PhaseData={version:1,settings,session:initial(settings)};
 try{const raw=localStorage.getItem(storageKey(database));if(!raw)return {data:fallback,error:''};const parsed:unknown=JSON.parse(raw);if(!validData(parsed))return {data:fallback,error:'本应用保存的数据无法读取，原记录保留。修改或开始前请先确认重置本应用记录。'};
  const checkpoint=localStorage.getItem(storageKey(database)+':session');if(checkpoint&&parsed.revision){try{const saved=JSON.parse(checkpoint);if(saved.revision===parsed.revision&&validData({...parsed,session:saved.session}))parsed.session=saved.session;}catch{/* Preserve a malformed checkpoint without applying it. */}}
  const total=parsed.session.gameDurationMs??(parsed.settings.gameMinutes??10)*60000;
  const safe:PhaseData={...parsed,session:{...parsed.session,gameDurationMs:total,elapsedMs:parsed.session.elapsedMs??Math.max(0,total-(parsed.session.gameRemainingMs??total)),status:parsed.session.status==='running'?'paused':parsed.session.status}};
  // Legacy IDs: character:<id>:<instruction>. New IDs include an encoded world segment.
  // Only migrate the selected character; never guess which world older prompts belonged to.
  const id=safe.settings.instructionCharacterId;
  if(id){
   const legacyPrefix='character:'+id+':';
   const newPrefix='character:'+encodeURIComponent(id)+'::';
   const legacy=safe.settings.prompts.filter(p=>p.id.startsWith(legacyPrefix)&&!p.id.startsWith(newPrefix)&&p.id.slice(legacyPrefix.length).indexOf(':')<0);
   if(legacy.length){
    const existing=new Set(safe.settings.prompts.map(p=>p.id));
    const migrated=legacy.map(p=>({...p,id:newPrefix+p.id.slice(legacyPrefix.length)})).filter(p=>!existing.has(p.id));
    const updated:PhaseData={...safe,settings:{...safe.settings,prompts:[...safe.settings.prompts.filter(p=>!legacy.includes(p)),...migrated]}};
    if(!validData(updated))return {data:safe,error:'旧指令格式需要人工确认，自动迁移已跳过；原记录保留。'};
    try{
     const backupKey=storageKey(database)+':pre-scope-migration';
     if(localStorage.getItem(backupKey)===null)localStorage.setItem(backupKey,raw);
     localStorage.setItem(storageKey(database),JSON.stringify(updated));
     return {data:updated,error:''};
    }catch{return {data:safe,error:'旧指令可读取，但迁移未能完成；原记录未主动删除。'};}
   }
  }
  return {data:safe,error:''};
 }catch{return {data:fallback,error:'无法读取本应用本地记录。请确认浏览器允许本地存储；其他数据未改动。'};}
}
export function savePhaseData(database:string,data:PhaseData){if(!validData(data))throw Error('设置不完整或超出范围，未保存。');const revision=crypto.randomUUID(),raw=JSON.stringify({...data,revision});if(new TextEncoder().encode(raw).length>libraryLimits.bytes)throw Error('本应用词库和历史超过3MB，请精简不需要的指令。原记录未更改。');try{localStorage.setItem(storageKey(database),raw);data.revision=revision;}catch{throw Error('本地保存失败，请检查浏览器存储权限或空间。当前页面内容仍保留。');}}

export function savePhaseSession(database:string,data:PhaseData){if(!data.revision||!validData(data))return;try{localStorage.setItem(storageKey(database)+":session",JSON.stringify({revision:data.revision,session:data.session}));}catch{throw Error("计时进度保存失败，请暂停并检查浏览器存储空间。");}}
