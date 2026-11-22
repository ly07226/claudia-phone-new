import {archiveNotes,readPrivateNotesArchive} from './privateNotesArchive';
import {db} from './store';
import {resolveApi} from './chatService';
import {requestReply} from './chatProvider';
import {activeMessages} from './messagePath';
import {memoryContext} from './memoryContext';
export type NoteKind='日记'|'备忘'|'梦境';
export type GeneratedNote={id:string;characterId:string;kind:NoteKind;createdAt:number;title:string;body:string;comments:string[];sourceLastMessageAt:number};
const PREFIX='claudia-private-notes-v2-';
const pending=new Set<string>();
export async function loadNotes(characterId:string):Promise<GeneratedNote[]>{const archived=(await readPrivateNotesArchive()).notes[characterId];if(archived)return archived;try{return JSON.parse(localStorage.getItem(PREFIX+characterId)||'[]')}catch{return []}}
export async function saveNotes(characterId:string,notes:GeneratedNote[]){await archiveNotes(characterId,notes);try{localStorage.setItem(PREFIX+characterId,JSON.stringify(notes))}catch{/* IndexedDB remains authoritative */}}
export async function generatePrivateNote(characterId:string,manual=false):Promise<GeneratedNote|null>{
 if(pending.has(characterId))return null;
 pending.add(characterId);
 try{
 const character=await db.characters.get(characterId);
 if(!character)throw Error('角色不存在');
 const conversation=await db.conversations.where('scopeKey').equals(JSON.stringify([characterId,'daily',''])).first();
 if(!conversation)throw Error('还没有该角色的日常聊天记录');
 const rows=(await activeMessages(conversation.id)).slice(-35).filter(m=>m.role==='user'||m.role==='assistant');
 const lastAt=rows.at(-1)?.createdAt||0;
 const existing=await loadNotes(characterId);
 if(!manual){
   const schedule=(await readPrivateNotesArchive()).schedule||{mode:'both',intervalMinutes:60};
   const latest=existing[0];
   const interval=Math.max(60,schedule.intervalMinutes||60)*60000;
   const due=!!latest&&Date.now()-latest.createdAt>=interval;
   const recent=!!lastAt&&Date.now()-lastAt<3*86400000;
   const newRows=rows.filter(m=>m.createdAt>(latest?.sourceLastMessageAt||0));
   const meaningful=newRows.some(m=>/我(答应|决定|承诺|辞职|搬家|生病|住院|离开|回来|喜欢你|爱你)|我们(约好|约定|见面|和好|分手)|已经(见面|和好|分手|搬家|辞职)|生日快乐|对不起|原谅你/.test(m.content));
   const important=recent&&meaningful&&(!latest||latest.sourceLastMessageAt<lastAt);
   const eligible=schedule.mode==='interval'?(due||!latest):schedule.mode==='important'?important:due||important||(!latest&&newRows.length>=6);
   if(!eligible||!recent||newRows.length===0||latest?.sourceLastMessageAt===lastAt)return null;
   if(rows.length<4)return null;
 }
 const memory=await memoryContext(conversation,rows,2400).catch(()=>({text:''}));
 const memoryText=memory.text.slice(0,2400);
 const transcript=rows.map(m=>(m.role==='user'?'玩家':'角色')+'：'+m.content.slice(0,500)).join('\n').slice(-10500);
 if(!transcript.trim())throw Error('没有可供书写的聊天内容');
 const kinds:NoteKind[]=['日记','梦境','备忘'];
 const kind=manual?kinds[Math.floor(Math.random()*kinds.length)]:kinds[(existing.length%3)];
 const lengths=kind==='日记'?'300–600':kind==='梦境'?'200–450':'60–180';
 const system=[
 '你正在以角色「'+character.name+'」的第一人称撰写私人记录，而不是回复玩家。',
 '角色设定：'+character.persona.slice(0,2600),
 '语言习惯：'+(character.speakingStyle||'自然、贴合人物').slice(0,1200),
 '文笔要求：成熟、克制、有辨识度；使用具体的动作、物件、感官和细微心理转折承载情绪，避免空泛抒情、流水账、鸡汤、套话、矫饰比喻、重复排比和过度描写眼睛。',
 '日记应有事件的起承转合与未说出口的内心；梦境要有独立的意象、空间与叙事，不把梦当现实；备忘简洁实用。',
 '只能使用给出的真实对话及已核实记忆作为已发生事实；记忆是背景，不得将旧事件写成今天刚发生。不得擅自决定玩家行为、情绪、经历或承诺。猜测必须明确为猜测。缺乏事实时不要补造剧情。',
 '请写一篇'+kind+'，正文目标'+lengths+'个汉字。标题简短有余味。输出严格 JSON：{"title":"...","body":"..."}，不要 Markdown 代码块。'
 ].join('\n');
 const {config,key}=await resolveApi(conversation);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);
 try{
  const result=await requestReply(config,key,[{role:'system',content:system},{role:'user',content:'当前时间：'+new Date().toLocaleString('zh-CN')+'\n以下是当前会话可用的记忆背景：\n'+memoryText+'\n以下是近期真实聊天节选：\n'+transcript}],controller.signal);
  const cleaned=result.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  let parsed:{title?:unknown;body?:unknown};
  try{parsed=JSON.parse(cleaned)}catch{throw Error('记录格式解析失败，请重试')}
  const minimum=kind==='日记'?180:kind==='梦境'?120:30;
  if(typeof parsed.title!=='string'||typeof parsed.body!=='string'||[...parsed.body.trim()].length<minimum)throw Error('记录内容不完整，未保存；请重试');
  const note:GeneratedNote={id:crypto.randomUUID(),characterId,kind,createdAt:Date.now(),title:parsed.title.slice(0,80),body:parsed.body.slice(0,5000),comments:[],sourceLastMessageAt:lastAt};
  await saveNotes(characterId,[note,...existing]);
  return note;
 }finally{clearTimeout(timer)}
 }finally{pending.delete(characterId)}
}
