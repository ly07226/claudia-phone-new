import type {Phase,PhaseSettings,PhaseSession} from './engine';
export const interventionTypes=['extend-green','faster','slower','next-phase'] as const;
export type InterventionType=typeof interventionTypes[number];
export interface InterventionEvent {id:string;type:InterventionType;line:string;delta?:number;phase?:Phase}
export interface InterventionPool {scope:string;characterName:string;createdAt:number;events:InterventionEvent[]}
export interface InterventionState extends InterventionPool {schedule:number[];used:string[];lastType?:InterventionType;lastElapsedMs?:number;nextPhase?:Phase}
export interface InterventionNotice {id:string;characterName:string;line:string;effect:string}
export const interventionScope=(s:PhaseSettings)=>JSON.stringify([s.instructionCharacterId??'',s.instructionWorldId??'',s.commandMode?'dirty':s.sweetMode?'sweet':'default',s.intensity??'medium']);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const phase=(v:unknown)=>['red','yellow','green'].includes(String(v));
export function validInterventionEvent(v:unknown):v is InterventionEvent {
 if(!obj(v)||typeof v.id!=='string'||!v.id||v.id.length>100||typeof v.line!=='string'||!v.line.trim()||v.line.length>100)return false;
 if(v.type==='next-phase')return phase(v.phase)&&v.delta===undefined;
 return ['extend-green','faster','slower'].includes(String(v.type))&&Number.isInteger(v.delta)&&finite(v.delta,5,v.type==='extend-green'?15:10)&&v.phase===undefined;
}
export function validInterventionPool(v:unknown):v is InterventionPool {
 return obj(v)&&typeof v.scope==='string'&&v.scope.length<=3000&&typeof v.characterName==='string'&&v.characterName.length>0&&v.characterName.length<=200&&finite(v.createdAt,0,1e16)&&Array.isArray(v.events)&&v.events.length>0&&v.events.length<=8&&v.events.every(validInterventionEvent)&&new Set(v.events.map(e=>e.id)).size===v.events.length;
}
export function validInterventionState(v:unknown):v is InterventionState {
 if(!validInterventionPool(v))return false;const r=v as unknown as Record<string,unknown>;
 return Array.isArray(r.schedule)&&r.schedule.length>0&&r.schedule.length<=2&&r.schedule.every((n,i,a)=>finite(n,30000,10800000)&&(i===0||Number(n)-Number(a[i-1])>=90000))&&Array.isArray(r.used)&&r.used.length<=2&&new Set(r.used).size===r.used.length&&r.used.every(id=>v.events.some(e=>e.id===id))&&(r.lastType===undefined||interventionTypes.includes(r.lastType as InterventionType))&&(r.lastElapsedMs===undefined||finite(r.lastElapsedMs,30000,10800000))&&(r.nextPhase===undefined||phase(r.nextPhase));
}
const unit=(random:()=>number)=>Math.max(0,Math.min(.999999999,random()||0));
export function prepareIntervention(s:PhaseSettings,total:number,pool:InterventionPool|undefined,random=Math.random):InterventionState|undefined {
 if(!s.aiIntervention||!validInterventionPool(pool)||pool.scope!==interventionScope(s)||total<=45000)return;
 const first=30000+Math.floor(unit(random)*Math.max(0,Math.min(30000,total-60000)));
 const schedule=[first],second=first+90000+Math.floor(unit(random)*Math.max(0,Math.min(60000,total-first-120000)));
 if(second<total-15000)schedule.push(second);
 return {...pool,events:pool.events.map(e=>({...e})),schedule,used:[]};
}
/** Pure allowlisted mutation. Total time, elapsed time and beat progress are never altered. */
export function applyIntervention(s:PhaseSettings,r:PhaseSession,event:InterventionEvent,currentBpm:number):{session:PhaseSession;effect:string}|undefined {
 if(!s.aiIntervention||r.status!=='running'||!validInterventionEvent(event)||(r.gameRemainingMs??0)<=15000)return;
 if(event.type==='extend-green'){
  if(r.phase!=='green')return;const extra=Math.floor(Math.min(event.delta!*1000,600000-r.remainingMs,(r.gameRemainingMs??0)-r.remainingMs)/1000)*1000;
  if(extra<5000)return;
  return {session:{...r,remainingMs:r.remainingMs+extra},effect:`绿灯 +${extra/1000} 秒 · 已生效`};
 }
 if(event.type==='next-phase'){
  if(!r.intervention||r.remainingMs>=(r.gameRemainingMs??0))return;
  return {session:{...r,intervention:{...r.intervention,nextPhase:event.phase}},effect:`下一阶段优先${{red:'红灯',yellow:'黄灯',green:'绿灯'}[event.phase!]} · 已生效`};
 }
 const amount=event.delta!*(event.type==='faster'?1:-1),target=Math.max(30,Math.min(180,currentBpm+amount)),actual=target-currentBpm;
 if(Math.abs(actual)<5-1e-9)return;
 return {session:{...r,bpmOffset:(r.bpmOffset??0)+actual},effect:`节拍 ${actual>0?'+':''}${Number(actual.toFixed(2))} BPM · 已生效`};
}
export function triggerIntervention(s:PhaseSettings,r:PhaseSession,currentBpm:number,random=Math.random):{session:PhaseSession;notice:InterventionNotice}|undefined {
 const state=r.intervention,elapsed=r.elapsedMs??0;
 if(!validInterventionState(state)||state.scope!==interventionScope(s)||!s.aiIntervention||r.status!=='running'||state.used.length>=Math.min(2,state.schedule.length)||elapsed<30000||elapsed<state.schedule[state.used.length]||(r.gameRemainingMs??0)<=15000||state.lastElapsedMs!==undefined&&elapsed-state.lastElapsedMs<90000)return;
 const legal=state.events.filter(e=>!state.used.includes(e.id)&&e.type!==state.lastType).flatMap(event=>{const result=applyIntervention(s,r,event,currentBpm);return result?[{event,result}]:[];});
 if(!legal.length)return;
 const {event,result}=legal[Math.floor(unit(random)*legal.length)];
 const session={...result.session,intervention:{...result.session.intervention!,used:[...state.used,event.id],lastType:event.type,lastElapsedMs:elapsed}};
 return {session,notice:{id:event.id,characterName:state.characterName,line:event.line,effect:result.effect}};
}
