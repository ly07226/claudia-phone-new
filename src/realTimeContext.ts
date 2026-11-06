import type {ContextMessage, Conversation, Message} from './chatTypes';
function deviceTimeZone(){
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return undefined;}
}
export const reliableMessageTime=(value:number,now:number)=>Number.isFinite(value)&&value>0&&value<=now&&Number.isFinite(new Date(value).getTime());
const duration=(milliseconds:number)=>`${Math.floor(milliseconds/60000)}分钟（按消息时间戳计算，向下取整）`;
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
  const rows=path.filter(m=>m.conversationId===conversationId&&!m.archived&&(m.role==='user'||m.role==='assistant'));
  // Generation runs after user messages are saved. Exclude the entire pending
  // user suffix, also for retries/regeneration, rather than treating it as past interaction.
  let start=rows.length;
  while(start>0&&rows[start-1].role==='user')start--;
  const previous=rows[start-1];
  if(previous&&reliableMessageTime(previous.createdAt,now)){
    lines.push(`上次有效互动（本轮用户消息之前，原始发送时间）：${formatAt(previous.createdAt)}。`);
    const elapsed=now-previous.createdAt;
    lines.push(`距离上次互动：${duration(elapsed)}。`);
    if(mode==='daily'){
      if(elapsed<30*60000)lines.push('[连续对话提示] 不足30分钟，默认保持当前连续对话。');
      else if(elapsed>=4*60*60000)lines.push('[新交流时段提示] 现实时间可能已进入新的交流时段，请结合当前设备时间、用户消息和原有场景判断。不要默认双方仍停留在上轮场景，或把旧动作当作现在正在继续；可以自然联系共同经历，但不得编造间隔期间用户或角色经历的具体事件。');
    }
    if(formatAt(previous.createdAt).slice(0,10)!==calendar.slice(0,10))lines.push('[日期变化提示] 现实自然日期已变化，但不能仅凭跨零点强制切换场景。');
  }
  if(mode==='world')lines.push('[剧本时间边界] 现实互动间隔不等于剧情时间跳跃，剧本时间推进仅以剧情内容和用户指令为准，不因现实间隔自动跳过剧情或动作。');
  lines.push('用户明确要求继续刚才的剧情、接着说或继续旧话题时，优先尊重用户意图，不因时间间隔强制切换场景。');
  lines.push('可以自然感知时间变化，不必每次主动提及时间，也不要求因用户长时间未出现而表现出责怪、等待或思念。不得为了表现时间感强行推进剧情；不得将现实时间流逝自动等同于剧本内时间流逝，除非聊天内容明确支持。没有提供的历史间隔不得猜测。');
  return {role:'system',content:lines.join('\n')};
}
