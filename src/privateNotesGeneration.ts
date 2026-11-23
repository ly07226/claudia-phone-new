import {archiveNotes,appendPrivateNote,appendPrivateNoteReply,privateNotesMetadata,readCharacterNotes,withPrivateNotesTask} from './privateNotesArchive';
import {db} from './store';
import {resolveApi} from './chatService';
import {requestReply} from './chatProvider';
import {activeMessages} from './messagePath';
import {memoryContext} from './memoryContext';
export type NoteKind='日记'|'备忘'|'梦境';
export type GeneratedNote={id:string;characterId:string;kind:NoteKind;createdAt:number;title:string;body:string;comments:(string|{author:'character';text:string})[];sourceLastMessageAt:number};
const PREFIX='claudia-private-notes-v2-';
const pending=new Set<string>();
export async function loadNotes(characterId:string):Promise<GeneratedNote[]>{
 const archived=await readCharacterNotes(characterId);if(archived.length){try{localStorage.removeItem(PREFIX+characterId)}catch{}return archived;}
 let legacy:GeneratedNote[]=[];try{legacy=JSON.parse(localStorage.getItem(PREFIX+characterId)||'[]')}catch{return []}
 if(!Array.isArray(legacy))return [];
 legacy=legacy.filter(n=>n.characterId===characterId&&n.id&&Array.isArray(n.comments));
 if(legacy.length){await archiveNotes(characterId,legacy);localStorage.removeItem(PREFIX+characterId)}return legacy;
}
export async function saveNotes(characterId:string,notes:GeneratedNote[]){await archiveNotes(characterId,notes);try{localStorage.removeItem(PREFIX+characterId)}catch{/* IndexedDB remains authoritative */}}
export async function generatePrivateNote(characterId:string,manual=false,requestedKind?:NoteKind):Promise<GeneratedNote|null>{
 if(pending.has(characterId))return null;
 pending.add(characterId);
 try{
 const character=await db.characters.get(characterId);
 if(!character)throw Error('角色不存在');
 const conversation=await db.conversations.where('scopeKey').equals(JSON.stringify([characterId,'daily',''])).first();
 if(!conversation)throw Error('还没有该角色的日常聊天记录');
 const snapshot=await activeMessages(conversation.id);
 const sourceText=JSON.stringify([conversation.activeTimelineId,conversation.timelineEpoch,snapshot.slice(-35).map(m=>[m.id,m.activeVariantId,m.content])]);
 const source=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceText)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const rows=snapshot.slice(-35).filter(m=>m.role==='user'||m.role==='assistant');
 const lastAt=rows.at(-1)?.createdAt||0;
 return await withPrivateNotesTask(characterId,false,'',async()=>{
 const latestConversation=await db.conversations.get(conversation.id);
 if(!latestConversation)throw Error('会话已不存在');
 const existing=await loadNotes(characterId);
 if(!manual){
   const schedule=(await privateNotesMetadata()).schedule||{mode:'both',intervalMinutes:60};
   const latest=existing.filter(n=>n.kind!=='梦境').sort((a,b)=>b.sourceLastMessageAt-a.sourceLastMessageAt||b.createdAt-a.createdAt)[0];
   const interval=Math.max(60,schedule.intervalMinutes||60)*60000;
   const due=!!latest&&Date.now()-Math.max(...existing.filter(n=>n.kind!=='梦境').map(n=>n.createdAt))>=interval;
   const recent=!!lastAt&&Date.now()-lastAt<3*86400000;
   const newRows=rows.filter(m=>m.createdAt>(latest?.sourceLastMessageAt||0));
   // A lightweight signal, not a claim that a keyword proves an important event.
   // Require a real exchange and avoid speculative or quoted scenarios.
   const newUser=newRows.filter(m=>m.role==='user');
   const newAssistant=newRows.filter(m=>m.role==='assistant');
   const meaningful=newUser.some(m=>{
     const content=m.content.trim();
     if(/^(如果|假如|假设|比如|举个例子|要是有一天)/.test(content))return false;
     return /我(答应|决定|承诺|辞职|搬家|生病|住院|离开|回来|喜欢你|爱你|害怕|难过|想你|担心|开心|委屈)|我们(约好|约定|见面|和好|分手)|已经(见面|和好|分手|搬家|辞职)|生日快乐|对不起|原谅你/.test(content);
   });
   const exchange=newUser.length>0&&newAssistant.length>0;
   const cooldown=!latest||Date.now()-latest.createdAt>=30*60000;
   const important=recent&&exchange&&meaningful&&cooldown;
   const eligible=schedule.mode==='interval'?(due||!latest):schedule.mode==='important'?important:due||important||(!latest&&newRows.length>=6);
   if(!eligible||!recent||newRows.length===0||latest?.sourceLastMessageAt===lastAt)return null;
   if(rows.length<4)return null;
 }
 return await withPrivateNotesTask(characterId+':automatic',!manual,source,async()=>{
 const memory=await memoryContext(conversation,rows,2400).catch(()=>({text:''}));
 const memoryText=(typeof memory==='string'?memory:memory.text).slice(0,2400);
 const today=new Date(),startOfToday=new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
 const latestSource=Math.max(0,...existing.filter(n=>n.kind!=='梦境').map(n=>n.sourceLastMessageAt||0));
 const transcript=rows.map(m=>{
   const when=m.createdAt>=startOfToday?'今天':new Date(m.createdAt).toLocaleDateString('zh-CN');
   const freshness=m.createdAt>latestSource?'本次新增':'既有上下文';
   return '['+when+' / '+freshness+'] '+(m.role==='user'?'玩家':'角色')+'：'+m.content.slice(0,500);
 }).join('\n').slice(-10500);
 if(!transcript.trim())throw Error('没有可供书写的聊天内容');
 // Diaries are the default; dreams are occasional and independent of today's events.
 // A memo is preferred only when a new, concrete plan or commitment appears.
 const newContent=rows.filter(m=>m.createdAt>latestSource).map(m=>m.content).join('\n');
 const hasPlan=/((明天|后天|周[一二三四五六日天]|下周|下个月|今晚|待会|记得|别忘|提醒|约好|约定).{0,28}(见面|去|做|买|带|打电话|联系|准备|拿|送|接|提醒|记住))|((要|准备|计划).{0,20}(去|买|做|见|联系|搬|送))/.test(newContent);
 // Ordinary automatic writing never sacrifices a diary to a random dream.
 // Dreams are generated independently on explicit request, avoiding surprise API charges.
 const kind:NoteKind=requestedKind|| (hasPlan&&Math.random()<0.55?'备忘':'日记');
 const lengths=kind==='日记'?'300–600':kind==='梦境'?'200–450':'60–180';
 const system=[
 '你正在以角色「'+character.name+'」的第一人称撰写私人记录，而不是回复玩家。',
 '角色设定：'+character.persona.slice(0,2600),
 '语言习惯：'+(character.speakingStyle||'自然、贴合人物').slice(0,1200),
 '文笔要求：成熟、克制、有辨识度；使用具体的动作、物件、感官和细微心理转折承载情绪，避免空泛抒情、流水账、鸡汤、套话、矫饰比喻、重复排比和过度描写眼睛。',
 '日记的核心是今天真实发生的互动：玩家告诉角色的事情、角色听到后的感受、角色自己在聊天里确实做过的行动、未说出口的念头与心境变化。普通的一句话也可以触动角色，不必虚构重大事件。优先写今日新增的互动，不把旧记忆当作今日事件；角色的内心可以复杂、矛盾、克制，不必一味温柔。',
 '备忘录只记录已明确的约定、计划、待办或角色自己的想法，不把猜测当承诺。梦境允许随机、荒诞、浪漫或压抑的虚构情节，不要求对应当天事件，也不暗示梦境真实发生；梦中的玩家言行不能变成现实设定。',
 '只能使用给出的真实对话及已核实记忆作为已发生事实；记忆是背景，不得将旧事件写成今天刚发生。不得擅自决定玩家行为、情绪、经历或承诺。猜测必须明确为猜测。缺乏事实时不要补造剧情。',
 '请写一篇'+kind+'，正文目标'+lengths+'个汉字。若今日互动平淡，写真实的细节与感触，不凑事件。标题简短有余味。输出严格 JSON：{"title":"...","body":"..."}，不要 Markdown 代码块。'
 ].join('\n');
 const {config,key}=await resolveApi(conversation);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);
 try{
  let interrupted=false;
  const result=await requestReply(config,key,[{role:'system',content:system},{role:'user',content:'当前时间：'+new Date().toLocaleString('zh-CN')+'\n以下是当前会话可用的记忆背景：\n'+memoryText+'\n以下是近期真实聊天节选：\n'+transcript}],controller.signal,undefined,false,reason=>{interrupted=!!reason});
  if(interrupted)throw Error('记录生成中断或达到输出限制，未保存；请手动重试');
  const cleaned=result.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  let parsed:{title?:unknown;body?:unknown};
  try{parsed=JSON.parse(cleaned)}catch{throw Error('记录格式解析失败，请重试')}
  const minimum=kind==='日记'?180:kind==='梦境'?120:30;
  if(!parsed||typeof parsed.title!=='string'||typeof parsed.body!=='string'||[...parsed.body.trim()].length<minimum||parsed.body.length>5000)throw Error('记录内容不完整，未保存；请重试');
  const note:GeneratedNote={id:crypto.randomUUID(),characterId,kind,createdAt:Date.now(),title:parsed.title.slice(0,80),body:parsed.body.slice(0,5000),comments:[],sourceLastMessageAt:lastAt};
  await db.transaction('rw',[db.themes,db.conversations,db.messages,db.messageVariants,db.timelines,db.pathNodes],async()=>{
   const current=await db.conversations.get(conversation.id),currentRows=await activeMessages(conversation.id);
   // Appending a new exchange does not invalidate an unchanged source prefix. Edits,
   // regeneration and branch switches do; validate and save under the same transaction.
   const prefix=currentRows.slice(Math.max(0,snapshot.length-35),snapshot.length);
   if(!current||currentRows.length<snapshot.length||JSON.stringify([current.activeTimelineId,current.timelineEpoch,prefix.map(m=>[m.id,m.activeVariantId,m.content])])!==sourceText)throw Error('聊天路径已变化，未保存过期记录；请手动重试');
   await appendPrivateNote(characterId,note);
  });
  return note;
 }finally{clearTimeout(timer)}
 });
 });
 }finally{pending.delete(characterId)}
}

/** A comment reply is an explicit user-triggered request, never an automatic extra charge. */
export async function replyToPrivateNoteComment(characterId:string,noteId:string,comment:string){
 return withPrivateNotesTask('reply:'+characterId+':'+noteId,false,'',async()=>{
 const character=await db.characters.get(characterId);
 if(!character)throw Error('角色不存在');
 const conversation=await db.conversations.where('scopeKey').equals(JSON.stringify([characterId,'daily',''])).first();
 if(!conversation)throw Error('日常聊天不存在');
 const note=(await loadNotes(characterId)).find(n=>n.id===noteId);
 if(!note||note.characterId!==characterId)throw Error('记录已不存在');
 const index=note.comments.length-1;
 if(note.comments[index]!==comment)return null;
 const {config,key}=await resolveApi(conversation);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  let interrupted=false;
  const answer=(await requestReply(config,key,[
   {role:'system',content:'你是'+character.name+'。人物设定：'+character.persona.slice(0,1600)+'。说话风格：'+(character.speakingStyle||'自然').slice(0,500)+'。你正在回复玩家对你私人'+note.kind+'的评论。用角色本人语气简短自然回复，1到3句话，不写新日记，不替玩家发言，不编造已发生的事件。'},
   {role:'user',content:'你的私人记录《'+note.title+'》：'+note.body.slice(0,1800)+'\n玩家评论：'+comment.slice(0,800)}
  ],controller.signal,undefined,false,reason=>{interrupted=!!reason})).trim();
  if(interrupted)throw Error('角色回复生成中断，请手动重试');
  if(!answer)throw Error('角色没有生成有效回复');
  if(answer.length>800)throw Error('角色回复过长，未保存；请手动重试');
  const reply=answer;
  await appendPrivateNoteReply(characterId,noteId,reply,index,comment);
  return reply;
 }finally{clearTimeout(timer)}
 });
}
