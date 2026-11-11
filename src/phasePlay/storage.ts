import {defaults,initial,validData,type PhaseData} from './engine';
// Separate from all chat, theme, credential and memory records. No database upgrade.
export const storageKey=(database:string)=>`claudia.phasePlay.v1:${database}`;
export function loadPhaseData(database:string):{data:PhaseData;error:string}{
 const settings=defaults(),fallback:PhaseData={version:1,settings,session:initial(settings)};
 try{const raw=localStorage.getItem(storageKey(database));if(!raw)return {data:fallback,error:''};const parsed:unknown=JSON.parse(raw);if(!validData(parsed))return {data:fallback,error:'本应用保存的数据无法读取，原记录保留。修改或开始前请先确认重置本应用记录。'};
  const safe:PhaseData={...parsed,session:{...parsed.session,status:parsed.session.status==='running'?'paused':parsed.session.status}};
  // Earlier builds used character:<id>:<instruction> without a world segment.
  // Migrate only the currently selected character, and only when no scoped copy exists.
  const id=safe.settings.instructionCharacterId;
  if(id){
   const legacyPrefix='character:'+id+':';
   const newPrefix='character:'+encodeURIComponent(id)+'::';
   const legacy=safe.settings.prompts.filter(p=>p.id.startsWith(legacyPrefix)&&!p.id.startsWith(newPrefix));
   if(legacy.length){
    const mapped=legacy.map(p=>({...p,id:newPrefix+p.id.slice(legacyPrefix.length)}));
    const seen=new Set(safe.settings.prompts.map(p=>p.id));
    const migrated=mapped.filter(p=>!seen.has(p.id));
    const updated:PhaseData={...safe,settings:{...safe.settings,prompts:[...safe.settings.prompts,...migrated]}};
    // Preserve the original legacy records until a verified write succeeds.
    if(migrated.length&&validData(updated)){
     try{localStorage.setItem(storageKey(database),JSON.stringify(updated));return {data:updated,error:''};}catch{return {data:safe,error:'旧角色指令仍可读取，但迁移备份未能保存。请检查本地存储空间。'};}
    }
   }
  }
  return {data:safe,error:''};
 }catch{return {data:fallback,error:'无法读取本应用本地记录。请确认浏览器允许本地存储；其他数据未改动。'};}
}
export function savePhaseData(database:string,data:PhaseData){if(!validData(data))throw Error('设置不完整或超出范围，未保存。');try{localStorage.setItem(storageKey(database),JSON.stringify(data));}catch{throw Error('本地保存失败，请检查浏览器存储权限或空间。当前页面内容仍保留。');}}
