import type {ContextMessage, Message} from './chatTypes';
function deviceTimeZone(){
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return undefined;}
}
const reliable=(value:number,now:number)=>Number.isFinite(value)&&value>0&&value<=now&&Number.isFinite(new Date(value).getTime());
const duration=(milliseconds:number)=>`${Math.floor(milliseconds/60000)}分钟（按消息时间戳计算，向下取整）`;
/** Pure presentation of current-path original timestamps; never reads variants or other scopes. */
export function realTimeContext(conversationId:string,path:readonly Message[],now=Date.now(),timeZone=deviceTimeZone()):ContextMessage|null{
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
  const lines=['[真实时间上下文]',`当前现实日期与时间（精确到分钟）：${calendar}`,`用户设备时区：${timeZone||'无法识别时区名称；以上按设备本地时间显示'}`];
  const rows=path.filter(m=>m.conversationId===conversationId&&!m.archived&&(m.role==='user'||m.role==='assistant'));
  // Generation runs after user messages are saved. Exclude the entire pending
  // user suffix, also for retries/regeneration, rather than treating it as past interaction.
  let start=rows.length;
  while(start>0&&rows[start-1].role==='user')start--;
  const previous=rows[start-1];
  if(previous&&reliable(previous.createdAt,now)){
    lines.push(`上次有效互动（本轮用户消息之前，原始发送时间）：${formatAt(previous.createdAt)}。`);
    lines.push(`距离上次互动：${duration(now-previous.createdAt)}。`);
  }
  lines.push('可以自然感知时间变化，不必每次主动提及时间，也不要求因用户长时间未出现而表现出责怪、等待或思念。不得为了表现时间感强行推进剧情；不得将现实时间流逝自动等同于剧本内时间流逝，除非聊天内容明确支持。没有提供的历史间隔不得猜测。');
  return {role:'system',content:lines.join('\n')};
}
