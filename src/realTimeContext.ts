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
  const newSession=mode==='daily'&&reliable&&elapsed!>=4*3600000;
  const resume=false,topicChange=false;
  return {previous,current,elapsed,resume,topicChange,newSession,reason:'long-gap'};
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
  if(mode==='daily')lines.push('[日常聊天优先级] 现实时间以本次请求提供的设备时间为准。过去聊天里出现的中午、早晨、昨天、地点和正在进行的动作只属于当时，不是当前现实。用户最新消息是当前话题的最高优先级：即使只相隔数秒，用户转向新话题也必须自然回应新话题，不要把新内容强行解释成旧场景的延续。保留共同经历和人物记忆，但不能把过去的现场动作、姿势或地点当作现在仍在发生。如果用户自然承接先前的事情，应理解其语义并继续；无需用户说任何控制剧情的指令。');
  if(previous&&reliableMessageTime(previous.createdAt,now)){
    lines.push(`上次有效互动（本轮用户消息之前，原始发送时间）：${formatAt(previous.createdAt)}。`);
    const elapsed=now-previous.createdAt;
    lines.push(`距离上次互动：${duration(elapsed)}。`);
    if(mode==='daily'){
      if(session.newSession){
        lines.push(`[新交流时段提示] 当前对话时段：新的现实交流时段。${session.reason==='long-gap'?'可靠互动间隔已达到4小时，默认开启新时段。':session.reason==='topic-change'?'用户当前表达显示交流情境发生变化。':'现实交流情境发生变化。'}`);
        lines.push('上一轮对话属于过去的交流时段，其事件属于共同历史，不是当前正在发生的现场。本轮待回复用户消息应作为当前时段的交流起点，不得强行解释成用户在旧场景里假装刚见面。不要默认双方仍停留在上轮场景；不机械延续旧地点、姿势、物品、动作或未完成的现场情节。允许自然提及过去的共同经历，但不得编造间隔期间用户或角色经历的具体事件。');
        lines.push('请求副本中的过去交流段与当前时段标签只是时间边界，不是角色台词或用户原文；标记后的原始内容保持不变。历史记录可作为记忆来源，不可据此自动续写旧现场；这些标签不覆盖角色人设、世界书规则或用户明确意图。');
      }
      else if(elapsed<30*60000)lines.push('[连续对话提示] 不足30分钟，若用户未改变话题可自然承接；用户改变话题时必须立即跟随。');
      else if(session.elapsed!==undefined)lines.push('[时间流逝提示] 仅提示实际时间间隔，保留对话连续性，不强制结束旧场景。');
    }
    if(formatAt(previous.createdAt).slice(0,10)!==calendar.slice(0,10))lines.push('[日期变化提示] 现实自然日期已变化，但不能仅凭跨零点强制切换场景。');
  }
  if(mode==='world')lines.push('[剧本时间边界] 现实互动间隔不等于剧情时间跳跃，剧本时间推进仅以剧情内容和用户指令为准，不因现实间隔自动跳过剧情或动作。');
  lines.push('[人物与场景连续性] 先从人物设定、关系、过去发生的事实和最新消息推断角色此刻所处的情境；区分已发生事件、尚未完成的约定、当前仍有证据支持的动作，以及仅属于旧时段的动作。不要因为时间过去就忘记关系和事件，也不要因为旧回复停在某个动作就默认现在仍在重复该动作。用户自然提到先前事件时可以顺畅承接，不要求任何切换或继续指令。未知的间隔经历保持未知；人物此刻在做什么可以符合人设自然回应，但不要将猜测冒充已经发生的共同事实。');
  lines.push('可以自然感知时间变化，不必每次主动提及时间，也不要求因用户长时间未出现而表现出责怪、等待或思念。不得为了表现时间感强行推进剧情；不得将现实时间流逝自动等同于剧本内时间流逝，除非聊天内容明确支持。没有提供的历史间隔不得猜测。');
  return {role:'system',content:lines.join('\n')};
}
