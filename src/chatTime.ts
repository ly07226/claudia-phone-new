import {reliableMessageTime} from './realTimeContext';
import type {Message} from './chatTypes';
const sameDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
export function chatTimeLabels(messages:readonly Message[],now=Date.now()):Map<string,string>{
  const labels=new Map<string,string>();
  if(!Number.isFinite(new Date(now).getTime()))return labels;
  const today=new Date(now);
  let previous:Date|undefined;
  for(const message of messages){
    if(!reliableMessageTime(message.createdAt,now)){previous=undefined;continue;}
    const date=new Date(message.createdAt);
    if(!previous||!sameDay(previous,date)||date.getTime()-previous.getTime()>=30*60000){
      const prefix=sameDay(date,today)?'':`${date.getFullYear()===today.getFullYear()?'':date.getFullYear()+'年'}${date.getMonth()+1}月${date.getDate()}日 `;
      labels.set(message.id,`${prefix}星期${'日一二三四五六'[date.getDay()]} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`);
    }
    previous=date;
  }
  return labels;
}
