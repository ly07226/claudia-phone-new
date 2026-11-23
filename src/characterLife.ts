import {db} from './store';

/** Lightweight, per-character simulated life state. It is NOT canonical chat memory. */
export type LifeEvent={id:string;title:string;status:'ongoing'|'paused'|'done';createdAt:number;updatedAt:number;detail:string};
export type CharacterLife={version:1;characterId:string;lastAdvancedAt:number;focus:string;mood:string;events:LifeEvent[]};
const PREFIX='character-life-v1:';
const MAX_GAP=30*86400000;
const key=(id:string)=>PREFIX+encodeURIComponent(id);
const row=(id:string,state:CharacterLife)=>({id:key(id),color:'#8995a3',font:'sans',iconStyle:'rounded',opacity:.36,blur:18,characterLife:state});
function initial(characterId:string,now:number):CharacterLife{return {version:1,characterId,lastAdvancedAt:now,focus:'',mood:'',events:[]}}
function valid(value:any,characterId:string):value is CharacterLife{return value?.version===1&&value.characterId===characterId&&Number.isFinite(value.lastAdvancedAt)&&Array.isArray(value.events)}
/** Time passes without generating events or calling an API. Never invent events simply because time elapsed. */
export async function advanceCharacterLife(characterId:string,now=Date.now()):Promise<CharacterLife>{
 if(!characterId)throw Error('角色 ID 不能为空');
 return db.transaction('rw',db.themes,async()=>{
  const stored=(await db.themes.get(key(characterId)) as any)?.characterLife;
  const state:CharacterLife=valid(stored,characterId)?stored:initial(characterId,now);
  const safeNow=Number.isFinite(now)?Math.max(0,now):Date.now();
  if(safeNow>state.lastAdvancedAt){
   // Long absences are not simulated minute-by-minute; only mark elapsed time.
   state.lastAdvancedAt=Math.min(safeNow,state.lastAdvancedAt+MAX_GAP);
   if(safeNow-state.lastAdvancedAt>0)state.lastAdvancedAt=safeNow;
  }
  await db.themes.put(row(characterId,state) as any);
  return state;
 });
}
export async function readCharacterLife(characterId:string):Promise<CharacterLife>{
 const stored=(await db.themes.get(key(characterId)) as any)?.characterLife;
 return valid(stored,characterId)?stored:initial(characterId,Date.now());
}
/** Explicit changes only. Diary prose and speculative model output cannot update state. */
export async function saveCharacterLife(characterId:string,patch:Pick<CharacterLife,'focus'|'mood'|'events'>):Promise<CharacterLife>{
 return db.transaction('rw',db.themes,async()=>{
  const stored=(await db.themes.get(key(characterId)) as any)?.characterLife;
  const previous:CharacterLife=valid(stored,characterId)?stored:initial(characterId,Date.now());
  const events=patch.events.slice(0,20).filter(e=>e&&typeof e.id==='string'&&typeof e.title==='string'&&['ongoing','paused','done'].includes(e.status)).map(e=>({...e,title:e.title.slice(0,120),detail:String(e.detail||'').slice(0,500)}));
  const next={...previous,focus:patch.focus.slice(0,300),mood:patch.mood.slice(0,200),events};
  await db.themes.put(row(characterId,next) as any);return next;
 });
}
export function lifePrompt(state:CharacterLife):string{
 const events=state.events.filter(e=>e.status!=='done').slice(0,8).map(e=>e.title+'（'+e.status+'）：'+e.detail).join('\n');
 return ['以下为角色独立生活状态，仅用于保持连续性，不是玩家经历或已核实聊天事实。','当前生活重心：'+(state.focus||'未设定'),'近期心境：'+(state.mood||'未设定'),'持续事件：'+(events||'暂无'),'上次状态推进：'+new Date(state.lastAdvancedAt).toLocaleString('zh-CN'),'未提供的事件不得虚构为已发生；不得据此推断玩家的行为或感情变化。'].join('\n');
}
