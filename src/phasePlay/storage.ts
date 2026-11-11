import {defaults,initial,validData,type PhaseData} from './engine';
// Separate from all chat, theme, credential and memory records. No database upgrade.
export const storageKey=(database:string)=>`claudia.phasePlay.v1:${database}`;
export function loadPhaseData(database:string):{data:PhaseData;error:string}{
 const settings=defaults(),fallback:PhaseData={version:1,settings,session:initial(settings)};
 try{const raw=localStorage.getItem(storageKey(database));if(!raw)return {data:fallback,error:''};const parsed:unknown=JSON.parse(raw);if(!validData(parsed))return {data:fallback,error:'本应用保存的数据无法读取，原记录保留。修改或开始前请先确认重置本应用记录。'};
  return {data:{...parsed,session:{...parsed.session,status:parsed.session.status==='running'?'paused':parsed.session.status}},error:''};
 }catch{return {data:fallback,error:'无法读取本应用本地记录。请确认浏览器允许本地存储；其他数据未改动。'};}
}
export function savePhaseData(database:string,data:PhaseData){if(!validData(data))throw Error('设置不完整或超出范围，未保存。');try{localStorage.setItem(storageKey(database),JSON.stringify(data));}catch{throw Error('本地保存失败，请检查浏览器存储权限或空间。当前页面内容仍保留。');}}
