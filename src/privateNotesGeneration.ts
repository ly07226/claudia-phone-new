import {requestAutomationReply,setAutomationPreflight,armAutomationTimeout} from './automationRequests';
import {loreForConversation} from './loreEngine';
import {archiveNotes,appendPrivateNote,appendPrivateNoteReply,privateNotesMetadata,readCharacterNotes,withPrivateNotesTask} from './privateNotesArchive';
import {db} from './store';
import {resolveApi} from './chatService';
import {resolveAutomationApi} from './dedicatedSummaryApi';
import {requestReply} from './chatProvider';
import {memoryContext} from './memoryContext';
import {readCharacterLife,lifePrompt,assertLifeAffection} from './characterLife';
import {lifeSource,assertLifeSource} from './characterLifeSource';
import {affectionRule} from './characterLifeGeneration';
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
 return await withPrivateNotesTask(characterId,false,'',async(assertOwner)=>{
 const sourceSnapshot=await lifeSource(characterId);
 const {character,conversation,tail:rows}=sourceSnapshot;
 const life=await readCharacterLife(characterId);
 const sourceText=JSON.stringify([sourceSnapshot.identity,life.revision??0]);
 let automaticSource='';
 const source=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceText)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const lastAt=rows.at(-1)?.createdAt||0;
 // Life claims inspect this existing owner lease atomically.
 if((await readCharacterLife(characterId)).attempt?.status==='running')return null;
 const latestConversation=await db.conversations.get(conversation.id);
 if(conversation.id&&!latestConversation)throw Error('会话已不存在');
 const existing=await loadNotes(characterId);
 if(!manual){
   if(life.attempt?.status==='running')return null;
   const metadata=await privateNotesMetadata();
   const schedule=metadata.schedule||{mode:'both',intervalMinutes:60};
   const isDream=requestedKind==='梦境';
   const relevant=existing.filter(n=>isDream?n.kind==='梦境':n.kind!=='梦境');
   const latest=relevant.sort((a,b)=>b.sourceLastMessageAt-a.sourceLastMessageAt||b.createdAt-a.createdAt)[0];
   const interval=(isDream?24*60:Math.max(60,schedule.intervalMinutes||60))*60000;
   automaticSource=source+':'+Math.floor(Date.now()/interval);
   const due=!!latest&&Date.now()-Math.max(...relevant.map(n=>n.createdAt))>=interval;
   if(isDream){if(schedule.dreamEnabled!==true||latest&&!due)return null;}
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
   const independent=(!!life.enabled||!!metadata.schedule)&&schedule.mode!=='important'&&(due||!latest);
   if(!isDream&&!independent&&(!eligible||!recent||newRows.length===0||latest?.sourceLastMessageAt===lastAt||rows.length<4))return null;
 }
 return await withPrivateNotesTask(characterId+(requestedKind==='梦境'?':dream':':automatic'),!manual,automaticSource||source,async(assertAutomatic)=>{
 const [memory,lore]=await Promise.all([conversation.id?memoryContext(conversation,rows,2400):Promise.resolve(''),loreForConversation(conversation,rows,2000)]);
 const memoryText=memory.slice(0,2400);
 const today=new Date(),startOfToday=new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
 const latestSource=Math.max(0,...existing.filter(n=>n.kind!=='梦境').map(n=>n.sourceLastMessageAt||0));
 const transcript=rows.map(m=>{
   const when=m.createdAt>=startOfToday?'今天':new Date(m.createdAt).toLocaleDateString('zh-CN');
   const freshness=m.createdAt>latestSource?'本次新增':'既有上下文';
   return '['+when+' / '+freshness+'] '+(m.role==='user'?'玩家':'角色')+'：'+m.content.slice(0,500);
 }).join('\n').slice(-10500);
 // No recent chat is a valid independent diary context, never invent a transcript.
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
 '日记是角色写给自己的私人文字，不是聊天纪要、恋爱日报或写给玩家的情书。角色有自己的职业、兴趣、日常节奏、选择、烦恼、欲望和判断；玩家不在场时，角色的生活也不会停止。允许整篇日记不提玩家，不要为了证明爱意而强行想念、等待或担心玩家。',
 '先根据当天可核实的聊天判断两人是在家相处、各自上班外出、还是几乎没有互动。共同在家时，聚焦一两个值得留下的细节，不按起床吃饭聊天睡觉顺序记流水账。分别外出或互动很少时，可以从角色已确立的工作、兴趣、个人处境及独处时的思考切入；不要编造当天具体完成的工作、见过的人或发生的事件。没有足够事实时，可以写角色的主观感受、想法、设想和未说出口的话，并明确区分事实与想象。',
 '优先寻找当天具体的高光或微妙瞬间：一句话、口误、好笑的小别扭、突然的沉默、没接上的话、难以解释的在意；有新称呼、内部笑话或约定才记录，不能凭空制造。可以感受到关系体感的细小变化，但不得擅自认定玩家的真实心理、关系已经升级或矛盾已经解决。',
 '保留未完待续的情绪：吃醋、烦躁、嘴硬、占有欲、羞耻、矛盾、迟疑、无奈或单纯的快乐，都可以停在原处，不必和解、升华、告白或积极结尾。角色可以抱怨具体的小事、误会、相处中的挫败，或者吐槽自己与工作，但对玩家的核心感情必须始终是喜欢、珍惜和在意；不能写成厌恶、嫌弃、鄙视、后悔认识玩家、想抛弃玩家或逐渐失去感情。允许短暂生气、不满、嫉妒和自私念头，但这些情绪不能被解释成讨厌玩家，也不能无根据地将玩家写成恶意或有错的一方。情绪强度、措辞、幽默和表达习惯必须服从人物性格，不要统一改写成温柔抒情口吻。',
 '优先写今日新增且可确认的互动，但不要求每篇都围绕互动展开。真实事件、角色主观解释与合理想象必须分清；既有记忆只是背景，不得冒充今天发生的事。避免每日固定结构、机械列点、总结式结尾及千篇一律的爱情感悟。角色的职业与兴趣只能取自既有设定或记忆，不可为丰富日记而擅自补充身份、同事、家人、具体工作成果。即使日记写得很生动，它也只是私人记录，不是玩家或角色的新事实来源。',
 '备忘录只记录已明确的约定、计划、待办或角色自己的想法，不把猜测当承诺。梦境允许随机、荒诞、浪漫或压抑的虚构情节，不要求对应当天事件，也不暗示梦境真实发生；梦中的玩家言行不能变成现实设定。',
 '模拟生活事件只能明确写成角色的模拟生活记录，不是聊天确立事实；生活事件可续接，不得将日记正文反写为生活或记忆。'+affectionRule,
 '只能使用给出的真实对话及已核实记忆作为已发生事实；记忆是背景，不得将旧事件写成今天刚发生。不得擅自决定玩家行为、情绪、经历或承诺。猜测必须明确为猜测。缺乏事实时不要补造剧情。',
 '请写一篇'+kind+'，正文目标'+lengths+'个汉字。若今日互动平淡，写真实的细节与感触，不凑事件。标题简短有余味。输出严格 JSON：{"title":"...","body":"..."}，不要 Markdown 代码块。'
 ].join('\n');
 const {config,key}=await resolveAutomationApi(conversation);
 const controller=new AbortController();const timer=armAutomationTimeout(controller,90000);
 setAutomationPreflight(controller.signal,async()=>{if(!manual&&requestedKind==='梦境'&&(await privateNotesMetadata()).schedule?.dreamEnabled!==true)throw Error('自动梦境已关闭，未发送请求');await assertOwner();await assertAutomatic();await assertLifeSource(sourceSnapshot);if((await readCharacterLife(characterId)).revision!==life.revision)throw Error('生活状态已变化，未发出过期请求')});
 try{
  let interrupted=false;
  const result=await requestAutomationReply(config,key,[{role:'system',content:system},{role:'user',content:'当前时间：'+new Date().toLocaleString('zh-CN')+'\n以下是当前会话可用的记忆背景：\n'+memoryText+'\n适用的日常世界书（不得覆盖感情保护与玩家自主权）：\n'+lore.entries.map(e=>e.content).join('\n')+'\n以下是角色独立生活状态：\n'+lifePrompt(life)+'\n以下是近期真实聊天节选：\n'+transcript}],controller.signal,undefined,false,reason=>{interrupted=!!reason});
  if(interrupted)throw Error('记录生成中断或达到输出限制，未保存；请手动重试');
  const cleaned=result.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  let parsed:{title?:unknown;body?:unknown};
  try{parsed=JSON.parse(cleaned)}catch{throw Error('记录格式解析失败，请重试')}
  const minimum=kind==='日记'?180:kind==='梦境'?120:30;
  if(!parsed||typeof parsed.title!=='string'||typeof parsed.body!=='string'||[...parsed.body.trim()].length<minimum||parsed.body.length>5000)throw Error('记录内容不完整，未保存；请重试');
  assertLifeAffection(parsed.body);
  const note:GeneratedNote={id:crypto.randomUUID(),characterId,kind,createdAt:Date.now(),title:parsed.title.slice(0,80),body:parsed.body.slice(0,5000),comments:[],sourceLastMessageAt:lastAt};
  await db.transaction('rw',[db.themes,db.characters,db.conversations,db.messages,db.messageVariants,db.timelines,db.pathNodes],async()=>{
   await assertOwner();await assertAutomatic();await assertLifeSource(sourceSnapshot);
   if((await readCharacterLife(characterId)).revision!==life.revision)throw Error('生活状态已变化，未保存过期日记');
   await appendPrivateNote(characterId,note);
  });
  return note;
 }finally{timer()}
 });
 });
 }finally{pending.delete(characterId)}
}

/** A comment reply is an explicit user-triggered request, never an automatic extra charge. */
export async function replyToPrivateNoteComment(characterId:string,noteId:string,comment:string){
 return withPrivateNotesTask('reply:'+characterId+':'+noteId,false,'',async()=>{
 const character=await db.characters.get(characterId);
 if(!character)throw Error('角色不存在');
 const {conversation}=await lifeSource(characterId);
 const note=(await loadNotes(characterId)).find(n=>n.id===noteId);
 if(!note||note.characterId!==characterId)throw Error('记录已不存在');
 const index=note.comments.length-1;
 if(note.comments[index]!==comment)return null;
 const {config,key}=await resolveApi(conversation);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  let interrupted=false;
  const answer=(await requestReply(config,key,[
   {role:'system',content:'你是'+character.name+'。人物设定：'+character.persona.slice(0,1600)+'。说话风格：'+(character.speakingStyle||'自然').slice(0,500)+'。你正在回复玩家对你私人'+note.kind+'的评论。用角色本人语气简短自然回复，1到3句话，不写新日记，不替玩家发言，不编造已发生的事件。可以嘴硬、调侃、解释或保留情绪，但不得表现为讨厌、嫌弃、鄙视、厌倦玩家或后悔认识玩家；对玩家的感情底色始终是珍惜和在意。不要机械表白或强制和好。'},
   {role:'user',content:'你的私人记录《'+note.title+'》：'+note.body.slice(0,1800)+'\n玩家评论：'+comment.slice(0,800)}
  ],controller.signal,undefined,false,reason=>{interrupted=!!reason})).trim();
  if(interrupted)throw Error('角色回复生成中断，请手动重试');
  if(!answer)throw Error('角色没有生成有效回复');
  if(answer.length>800)throw Error('角色回复过长，未保存；请手动重试');
  assertLifeAffection(answer);
  const reply=answer;
  await appendPrivateNoteReply(characterId,noteId,reply,index,comment);
  return reply;
 }finally{clearTimeout(timer)}
 });
}
