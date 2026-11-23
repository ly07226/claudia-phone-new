import {db} from './store';
import type {GroupRoom,GroupMessage} from './groupChatCore';
import {validateGroupRoom} from './groupChatCore';
const PREFIX='group-room:';
const ROOM_PREFIX=PREFIX+'room:';
const MESSAGE_PREFIX=PREFIX+'message:';
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
export async function listGroupMessages(groupId:string):Promise<GroupMessage[]>{
 const prefix=MESSAGE_PREFIX+groupId+':';
 const rows=await db.themes.where('id').startsWith(prefix).toArray();
 return rows.map(r=>(r as unknown as MessageRow).groupMessage).filter(m=>m?.groupId===groupId).sort((a,b)=>a.createdAt-b.createdAt);
}
export async function appendGroupMessages(groupId:string,messages:GroupMessage[]):Promise<void>{
 if(!messages.length||messages.some(m=>m.groupId!==groupId))throw Error('群聊消息归属不一致');
 await db.transaction('rw',db.themes,async()=>{
  const roomRow=await db.themes.get(ROOM_PREFIX+groupId) as unknown as GroupRow|undefined;
  if(!roomRow?.groupRoom)throw Error('群聊不存在');
  const allowed=new Set(roomRow.groupRoom.memberIds);
  if(messages.some(m=>m.authorId!=='player'&&!allowed.has(m.authorId)))throw Error('消息作者不属于群聊');
  await db.themes.bulkPut(messages.map(m=>({...themeFields,id:PREFIX+'message:'+groupId+':'+m.id,groupMessage:m})) as any);
  await db.themes.put({...roomRow,groupRoom:{...roomRow.groupRoom,updatedAt:Date.now()}} as any);
 });
}
