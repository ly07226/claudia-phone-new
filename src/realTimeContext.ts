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
  const resume=current.some(m=>{
    const text=m.content.trim();
    if(/^(?:不要|不想|别|不再|不用|不必).{0,8}(?:继续|接着)/u.test(text))return false;
    return /继续.{0,12}(?:刚才|之前|上次|昨晚|昨天|旧|剧情|场景|话题)|(?:接着|接上).{0,16}(?:说|聊|剧情|场景|刚才|之前)|^(?:继续|接着说|继续吧)[。！!～~\s]*$/u.test(text);
  });
  const greeting=current.some(m=>/^(?:早上好|晚上好|下午好|上午好|中午好|早安|晚安|我回来了|(?:我)?(?:刚刚|刚)下班(?:了)?|(?:我)?(?:刚刚|刚)(?:睡)?醒(?:了)?)(?:[呀啊哦呢啦了～~！!。，,?？\s]|$)/u.test(m.content.trim()));
  const newSession=mode==='daily'&&reliable&&!resume&&(elapsed!>=4*3600000||(elapsed!>=30*60000&&greeting));
  return {previous,current,elapsed,resume,newSession,reason:elapsed!==undefined&&elapsed>=4*3600000?'long-gap':'greeting'};
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
    return {role:m.role as 'user'|'assistant',content:marker?`${marker}\n\n${m.content}`:m.content};
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
  if(previous&&reliableMessageTime(previous.createdAt,now)){
    lines.push(`上次有效互动（本轮用户消息之前，原始发送时间）：${formatAt(previous.createdAt)}。`);
    const elapsed=now-previous.createdAt;
    lines.push(`距离上次互动：${duration(elapsed)}。`);
    if(mode==='daily'){
      if(elapsed<30*60000)lines.push('[连续对话提示] 不足30分钟，默认保持当前连续对话。');
      else if(session.newSession){
        lines.push(`[新交流时段提示] 当前对话时段：新的现实交流时段。${session.reason==='long-gap'?'可靠互动间隔已达到4小时，默认开启新时段。':'可靠互动间隔达到30分钟，且本轮问候或回归表达是新时段开始的信号。'}`);
        lines.push('上一轮对话属于过去的交流时段，其事件属于共同历史，不是当前正在发生的现场。本轮待回复用户消息应作为当前时段的交流起点，不得强行解释成用户在旧场景里假装刚见面。不要默认双方仍停留在上轮场景；不机械延续旧地点、姿势、物品、动作或未完成的现场情节。允许自然提及过去的共同经历，但不得编造间隔期间用户或角色经历的具体事件。');
        lines.push('请求副本中的过去交流段与当前时段标签只是时间边界，不是角色台词或用户原文；标记后的原始内容保持不变。历史记录可作为记忆来源，不可据此自动续写旧现场；这些标签不覆盖角色人设、世界书规则或用户明确意图。');
      }else if(session.resume)lines.push('[当前对话时段：延续旧场景] 用户明确要求继续之前的剧情或话题，允许延续原场景，不因现实间隔强制切换。');
      else if(session.elapsed!==undefined)lines.push('[时间流逝提示] 仅提示实际时间间隔，保留对话连续性，不强制结束旧场景。');
    }
    if(formatAt(previous.createdAt).slice(0,10)!==calendar.slice(0,10))lines.push('[日期变化提示] 现实自然日期已变化，但不能仅凭跨零点强制切换场景。');
  }
  if(mode==='world')lines.push('[剧本时间边界] 现实互动间隔不等于剧情时间跳跃，剧本时间推进仅以剧情内容和用户指令为准，不因现实间隔自动跳过剧情或动作。');
  lines.push('用户明确要求继续刚才的剧情、接着说或继续旧话题时，优先尊重用户意图，不因时间间隔强制切换场景。');
  lines.push('可以自然感知时间变化，不必每次主动提及时间，也不要求因用户长时间未出现而表现出责怪、等待或思念。不得为了表现时间感强行推进剧情；不得将现实时间流逝自动等同于剧本内时间流逝，除非聊天内容明确支持。没有提供的历史间隔不得猜测。');
  return {role:'system',content:lines.join('\n')};
}
