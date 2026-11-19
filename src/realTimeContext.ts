import type {ContextMessage, Conversation, Message} from './chatTypes';
function deviceTimeZone(){
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return undefined;}
}
export const reliableMessageTime=(value:number,now:number)=>Number.isFinite(value)&&value>0&&value<=now&&Number.isFinite(new Date(value).getTime());
const duration=(milliseconds:number)=>`${Math.floor(milliseconds/60000)}分钟（按消息时间戳计算，向下取整）`;
/** Determine a presentation boundary from the active path only, without model calls. */
export function realTimeSession(conversationId:string,path:readonly Message[],now:number,mode:Conversation['mode']){
  const rows=path.filter(m=>m.conversationId===conversationId&&!m.archived&&(m.role==='user'||m.role==='assistant'));
  let start=rows.length;
  while(start>0&&rows[start-1].role==='user')start--;
  const previous=rows[start-1],current=rows.slice(start);
  const elapsed=previous&&reliableMessageTime(previous.createdAt,now)?now-previous.createdAt:undefined;
  const reliable=elapsed!==undefined&&current.length>0&&current.every(m=>reliableMessageTime(m.createdAt,now)&&m.createdAt>=previous!.createdAt);
  // A gap is evidence of elapsed real time, not a command to change topics.
  // Natural continuation is interpreted by the model using the latest message,
  // character state and history; no user-facing trigger phrases are required.
  // Elapsed time is evidence only. Do not reset the scene or memories by a fixed threshold.
  const newSession=false,resume=false,topicChange=false;
  return {previous,current,elapsed,resume,topicChange,newSession,reason:'time-evidence'};

}
export const sessionMarkers={
  history:'[过去交流时段开始：以下记录仅作共同历史，不是当前现场]',
  lastHistory:'[过去交流时段的最后记录：以下动作属于过去，不是当前正在发生的动作]',
  current:'[当前交流时段起点：不自动延续旧现场，以此后的用户消息开始当前交流]',
};
export const sessionMarkerChars=Object.values(sessionMarkers).reduce((n,text)=>n+text.length+2,0);
/** Annotate request copies only. Original user text, roles, stored messages and lore scanning remain unchanged. */
export function sessionHistory(history:readonly Message[],session:ReturnType<typeof realTimeSession>):ContextMessage[]{
  const currentIds=new Set(session.current.map(m=>m.id));
  const firstCurrent=history.findIndex(m=>currentIds.has(m.id));
  let lastHistory=-1;
  for(let i=history.length-1;i>=0;i--)if(!currentIds.has(history[i].id)){lastHistory=i;break;}
  const firstHistory=history.findIndex(m=>!currentIds.has(m.id));
  return history.map((m,i)=>{
    const marker=session.newSession?(i===firstCurrent?sessionMarkers.current:i===lastHistory?sessionMarkers.lastHistory:i===firstHistory?sessionMarkers.history:undefined):undefined;
    const content=marker?`${marker}\n\n${m.content}`:m.content;
    // Keep the boundary adjacent to the last user turn, where the model chooses
    // its next action; earlier history markers alone are easy to overlook.
    const isLatestCurrentUser=session.newSession&&m.role==='user'&&currentIds.has(m.id)&&
      !history.slice(i+1).some(next=>next.role==='user'&&currentIds.has(next.id));
    return {role:m.role as 'user'|'assistant',content:isLatestCurrentUser?
      `${content}\n\n[当前时段回复约束：以上是用户此刻的新消息。旧时段的动作、姿势、地点和未完成情节仅为过去记忆，不能当作当前正在发生。先回应本条消息的字面意图；根据最新消息是否自然承接旧事件来判断；不要把没有证据的旧动作直接当作现在的动作。保留人物性格与共同经历，不臆造间隔期间发生的事。]`:content};
  });
}
/** Pure presentation of current-path original timestamps; never reads variants or other scopes. */
export function realTimeContext(conversationId:string,path:readonly Message[],now=Date.now(),timeZone=deviceTimeZone(),mode:Conversation['mode']='daily'):ContextMessage|null{
  if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))return null;
  let formatAt:(timestamp:number)=>string;
  let calendar:string;
  try{
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    formatAt=(timestamp)=>{
      const parts=formatter.formatToParts(timestamp);
      const part=(name:string)=>parts.find(p=>p.type===name)?.value;
      return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
    };
    calendar=formatAt(now);
  }catch{return null;}
  const localParts=new Intl.DateTimeFormat('zh-CN',{timeZone,weekday:'long',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const hour=Number(localParts.find(p=>p.type==='hour')?.value);
  const period=hour<5?'凌晨':hour<8?'早上':hour<12?'上午':hour<14?'中午':hour<17?'下午':hour<19?'傍晚':'晚上';
  const weekday=localParts.find(p=>p.type==='weekday')?.value;
  const lines=['[真实时间上下文]',`当前现实日期与时间（精确到分钟）：${calendar}`,`用户设备时区：${timeZone||'无法识别时区名称；以上按设备本地时间显示'}`];
  lines.push(`当前星期与时段：${weekday}，${period}。`);
  lines.push('用户明确询问现实时间（现在几点、今天星期几、现在是早上还是晚上等）时，优先使用本上下文的设备日期、时间、星期和时区，不得依据剧情、旧消息或自身知识猜测。设备时钟不保证绝对准确。');
  const session=realTimeSession(conversationId,path,now,mode);
  const {previous}=session;
  if(mode==='daily'&&session.current.length){
    const latest=[...session.current].reverse().find(m=>m.role==='user');
    const lastCharacter=[...path].reverse().find(m=>m.role==='assistant'&&reliableMessageTime(m.createdAt,now));
    const priorCharacter=lastCharacter&&lastCharacter.createdAt<=(session.previous?.createdAt??now);
    lines.push('[本轮情境证据] 以下是供人物判断的原始证据，不是新的剧情事实。');
    if(lastCharacter&&priorCharacter)lines.push(`此前角色最后一次发言时间：${formatAt(lastCharacter.createdAt)}；这条发言属于此前时刻，不保证其中的姿势、地点或动作在现在持续。`);
    if(latest)lines.push(`本轮用户消息时间：${formatAt(latest.createdAt)}；应优先理解其自然语言意图，不要求用户说切换场景、继续剧情等指令。`);
    lines.push('判断顺序：先确认双方关系及此前事件，再判断现实时间是否已过去、旧动作是否仍有持续依据，最后结合用户当前消息自然回复。事实可以保留，动作是否持续必须有证据；不确定时不要强行续演旧动作，也不必向用户解释这套判断。');
  }
  if(mode==='daily')lines.push('[角色自主时间推进] 现实中的时间不只作用于用户，也同样作用于角色：两次互动之间，角色不是被暂停在上一条回复的动作、位置或姿势里。依据已经确立的角色职业、作息、生活习惯、双方共同空间、日程、约定和最后一次可靠状态，推断角色当前合理的活动阶段与位置；优先响应用户最新消息，并让角色以当下自己的状态自然行动和说话。角色可以有独立于用户的日常事务与即时行动，但不得把未展示、未确认的离线事件、共同经历、用户行为或双方分离过程写成已经发生的确定事实。若上一时刻双方同处一室，时间过去后不能机械地把用户当作远程网友，也不能假定角色仍留在原地；根据最新消息对场景作最小必要更新，无法确定的中间细节保持开放。不要逐项解释时间推理，不要每次都报告日程，不要用模板式的“刚忙完”“等你回来”替代人物性格。');
  if(mode==='daily')lines.push('[日常聊天优先级] 现实时间以本次请求提供的设备时间为准。过去聊天里出现的中午、早晨、昨天、地点和正在进行的动作只属于当时，不是当前现实。用户最新消息决定本轮回应的焦点，不决定历史事实是否存在。即使只相隔数秒，用户自然转向新话题也要自然回应；即使相隔很久，用户自然承接旧话题也应理解。保留共同经历、未解决事项和人物记忆，但不能把过去的现场动作、姿势或地点当作现在仍在发生。如果用户自然承接先前的事情，应理解其语义并继续；无需用户说任何控制剧情的指令。');
  if(previous&&reliableMessageTime(previous.createdAt,now)){
    lines.push(`上次有效互动（本轮用户消息之前，原始发送时间）：${formatAt(previous.createdAt)}。`);
    const elapsed=now-previous.createdAt;
    lines.push(`距离上次互动：${duration(elapsed)}。`);
    if(mode==='daily')lines.push('[时间与语义判断] 时间间隔只说明现实时间经过，不决定话题切换、记忆清空或动作继续。根据本轮消息和历史语义判断是否自然承接上次话题；即使当前谈论另一件事，也保留人物关系、过去事实、承诺、共同经历及相关长期记忆。');

    if(formatAt(previous.createdAt).slice(0,10)!==calendar.slice(0,10))lines.push('[日期变化提示] 现实自然日期已变化，但不能仅凭跨零点强制切换场景。');
  }
  if(mode==='world')lines.push('[剧本时间边界] 现实互动间隔不等于剧情时间跳跃，剧本时间推进仅以剧情内容和用户指令为准，不因现实间隔自动跳过剧情或动作。');
  lines.push('[人物与场景连续性] 先从人物设定、关系、过去发生的事实和最新消息推断角色此刻所处的情境；区分已发生事件、尚未完成的约定、当前仍有证据支持的动作，以及仅属于旧时段的动作。不要因为时间过去就忘记关系和事件，也不要因为旧回复停在某个动作就默认现在仍在重复该动作。用户自然提到先前事件时可以顺畅承接，不要求任何切换或继续指令。未知的间隔经历保持未知；人物此刻在做什么可以符合人设自然回应，但不要将猜测冒充已经发生的共同事实。');
  lines.push('可以自然感知时间变化，不必每次主动提及时间，也不要求因用户长时间未出现而表现出责怪、等待或思念。不得为了表现时间感强行推进剧情；不得将现实时间流逝自动等同于剧本内时间流逝，除非聊天内容明确支持。没有提供的历史间隔不得猜测。');
  return {role:'system',content:lines.join('\n')};
}
