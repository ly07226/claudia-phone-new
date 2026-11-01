import type Dexie from 'dexie';
import {backupTables,rowBytes,sha,utf8,tableSeed,nextDigest} from './backupFormat';
const key='claudia.restore.receipt.v1';
export async function stageImportReceipt(database:Dexie,planned:Dexie,expected:Record<string,{count:number;digest:string}>){
  const counts:Record<string,number>={};for(const table of backupTables)counts[table]=await planned.table(table).count();
  const characters=expected.characters.digest;
  const theme=await sha(await rowBytes('themes',(await planned.table('themes').get('global'))??null));
  localStorage.setItem(key,JSON.stringify({version:2,target:database.name,origin:location.origin,counts,characters,theme}));
}
export async function startupImportNotice(database:Dexie,loaded:{characters:any[];theme:any}):Promise<string>{
  const raw=localStorage.getItem(key);if(!raw)return '';let r:any;try{r=JSON.parse(raw);}catch{return '导入启动复核信息损坏，请回到备份页检查，不能确认恢复成功。';}
  if(![1,2].includes(r.version)||r.target!==database.name||r.origin!==location.origin)return '';
  const counts:Record<string,number>={};for(const table of backupTables)counts[table]=await database.table(table).count();
  // IndexedDB primary string ordering is code point ordering, not locale ordering.
  const ordered=[...loaded.characters].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  let canonicalHash=await tableSeed('characters');
  if(r.version===1){try{canonicalHash=await sha(utf8(JSON.stringify(ordered)));}catch{return '导入启动复核未通过：旧复核格式无法读取扩展资料，请在备份页重新核对。';}}
  else for(const row of ordered)canonicalHash=await nextDigest(canonicalHash,await rowBytes('characters',row));
  const theme=await sha(await rowBytes('themes',loaded.theme));
  const match=backupTables.every(t=>counts[t]===r.counts?.[t])&&canonicalHash===r.characters&&theme===r.theme;
  if(!match)return `导入启动复核未通过：当前角色 ${loaded.characters.length}，预期 ${r.counts?.characters??'未知'}。可能导入未提交或数据已变化；请检查当前站点 ${location.origin} 与备份明细，不能将校验成功当作恢复成功。`;
  localStorage.removeItem(key);
  const visible=loaded.characters.filter(c=>!c.dailyFriendship||c.dailyFriendship.status==='friend').length;
  return `导入成功，启动复核通过：角色 ${loaded.characters.length}，日常好友 ${visible}，会话 ${counts.conversations}，消息 ${counts.messages}，世界 ${counts.worlds}，用户身份 ${Object.keys(loaded.theme.userIdentities??{}).length}，图片 ${counts.assets}，API 配置 ${counts.apiConfigs}。当前站点：${location.origin}。`;
}
