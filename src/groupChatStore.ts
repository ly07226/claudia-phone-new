import {db} from './store';
import type {GroupRoom,GroupMessage} from './groupChatCore';
import {validateGroupRoom} from './groupChatCore';
const PREFIX='group-room:';
const ROOM_PREFIX=PREFIX+'room:';
const MESSAGE_PREFIX=PREFIX+'message:';
const MESSAGE_V2_PREFIX=PREFIX+'message-v2:';
const RECENT_LIMIT=100;
const messageKey=(groupId:string,m:GroupMessage)=>MESSAGE_V2_PREFIX+groupId+':'+String(m.createdAt).padStart(15,'0')+':'+m.id;
export type GroupMessageCursor=Pick<GroupMessage,'createdAt'|'id'>;
/** Migrate legacy random-key rows once so recent reads can use the primary-key index. */
async function migrateGroupMessages(groupId:string):Promise<void>{
 const legacyPrefix=MESSAGE_PREFIX+groupId+':';
 // Bounded batches prevent the first opening of a long-lived group from loading
 // its entire history into memory. Each batch is committed atomically.
 for(;;){
  const migrated=await db.transaction('rw',db.themes,async()=>{
   const old=await db.themes.where('id').startsWith(legacyPrefix).limit(100).toArray();
   if(!old.length)return 0;
   const valid=old.map(row=>(row as unknown as MessageRow).groupMessage).filter((m):m is GroupMessage=>!!m&&m.groupId===groupId);
   if(valid.length!==old.length)throw Error('旧群聊记录不完整，已停止迁移以保护数据');
   await db.themes.bulkPut(valid.map(m=>({...themeFields,id:messageKey(groupId,m),groupMessage:m})) as any);
   await db.themes.bulkDelete(old.map(row=>row.id));
   return old.length;
  });
  if(!migrated)return;
  if(migrated<100)return;
 }
}
type GroupRow={id:string;color:string;font:string;iconStyle:'rounded';opacity:number;blur:number;groupRoom:GroupRoom};
type MessageRow={id:string;color:string;font:string;iconStyle:'rounded';opacity:number;blur:number;groupMessage:GroupMessage};
const themeFields={color:'#8995a3',font:'sans',iconStyle:'rounded' as const,opacity:0.4,blur:12};
export async function listGroupRooms():Promise<GroupRoom[]>{
 const rows=await db.themes.where('id').startsWith(ROOM_PREFIX).toArray();
 return rows.filter(r=>r.id.startsWith(ROOM_PREFIX)).map(r=>(r as unknown as GroupRow).groupRoom).filter(Boolean).sort((a,b)=>b.updatedAt-a.updatedAt);
}
export async function saveGroupRoom(room:GroupRoom):Promise<void>{
 const ids=new Set((await db.characters.toArray()).map(c=>c.id));
 const safe=validateGroupRoom(room,ids);
 await db.themes.put({...themeFields,id:ROOM_PREFIX+safe.id,groupRoom:safe} as any);
}
export async function listGroupMessages(groupId:string,limit=RECENT_LIMIT,before?:GroupMessageCursor):Promise<GroupMessage[]>{
 await migrateGroupMessages(groupId);
 const prefix=MESSAGE_V2_PREFIX+groupId+':';
 const lower=prefix;
 const upper=before===undefined?prefix+'\uffff':prefix+String(before.createdAt).padStart(15,'0')+':'+before.id;
 const rows=await db.themes.where('id').between(lower,upper,false,false).reverse().limit(Math.max(1,Math.min(limit,500))).toArray();
 return rows.map(r=>(r as unknown as MessageRow).groupMessage).filter(m=>m?.groupId===groupId).reverse();
}
export async function appendGroupMessages(groupId:string,messages:GroupMessage[]):Promise<void>{
 if(!messages.length||messages.some(m=>m.groupId!==groupId))throw Error('群聊消息归属不一致');
 await db.transaction('rw',db.themes,async()=>{
  const roomRow=await db.themes.get(ROOM_PREFIX+groupId) as unknown as GroupRow|undefined;
  if(!roomRow?.groupRoom)throw Error('群聊不存在');
  const allowed=new Set(roomRow.groupRoom.memberIds);
  const latestRows=await db.themes.where('id').between(MESSAGE_V2_PREFIX+groupId+':',MESSAGE_V2_PREFIX+groupId+':\uffff',false,false).reverse().limit(1).toArray();
  const last=(latestRows[0] as unknown as MessageRow|undefined)?.groupMessage;
  if(messages[0]?.authorId==='player'&&last?.authorId==='player')throw Error('上一条玩家消息尚未获得回复，请先重试');
  if(messages.some(m=>m.authorId!=='player'&&!allowed.has(m.authorId)))throw Error('消息作者不属于群聊');
  await db.themes.bulkPut(messages.map(m=>({...themeFields,id:messageKey(groupId,m),groupMessage:m})) as any);
  const latest=messages.reduce((a,m)=>m.createdAt>a.createdAt?m:a,messages[0]);
  const lastMessage={authorId:latest.authorId,text:latest.text.slice(0,120),imageCount:latest.imageIds?.length??0,createdAt:latest.createdAt};
  await db.themes.put({...roomRow,groupRoom:{...roomRow.groupRoom,updatedAt:Date.now(),lastMessage}} as any);
 });
}
