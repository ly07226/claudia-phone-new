import {baseInstructions} from './instructions';
import {libraryLimits,normalizedInstruction,promptScope,selectedScope,type LibraryVersion} from './library';
export const phases=['red','yellow','green'] as const;
export type Phase=typeof phases[number];
export const phaseNames:Record<Phase,string>={red:'红灯',yellow:'黄灯',green:'绿灯'};
export interface Prompt {id:string;phase:Phase|'all';text:string}
export interface PhaseSettings {mode:'sequence'|'random';randomDuration:boolean;duration:Record<Phase,{seconds:number;min:number;max:number}>;bpm:number;beat:boolean;sound:boolean;volume:number;vibration:boolean;prompts:Prompt[];sweetMode?:boolean;commandMode?:boolean;address?:string;intensity?:'soft'|'medium'|'strong'|'dramatic';instructionMode?:'default'|'character';instructionCharacterId?:string;instructionWorldId?:string;autoAccelerate?:boolean;maxBpm?:number;accelerationSeconds?:number;gameMinutes?:number}
export interface DrawBag {scope:string;used:string[];lastId?:string}
export interface PhaseSession {status:'idle'|'running'|'paused'|'finished';phase:Phase;remainingMs:number;step:number;prompt:string;gameRemainingMs?:number;gameDurationMs?:number;elapsedMs?:number;draws?:Partial<Record<Phase,DrawBag>>}
export interface PhaseData {version:1;revision?:string;settings:PhaseSettings;session:PhaseSession;libraryVersions?:Record<string,LibraryVersion[]>}
export function defaults():PhaseSettings{return {mode:'sequence',randomDuration:false,duration:{red:{seconds:5,min:3,max:8},yellow:{seconds:15,min:10,max:20},green:{seconds:60,min:40,max:80}},bpm:60,beat:true,sound:false,volume:.2,vibration:false,prompts:[],sweetMode:false,commandMode:false,address:'',intensity:'medium',instructionMode:'default',instructionCharacterId:'',instructionWorldId:'',autoAccelerate:false,maxBpm:120,accelerationSeconds:120,gameMinutes:10};}
const unit=(random:()=>number)=>{const n=random();return Number.isFinite(n)?Math.min(.999999999,Math.max(0,n)):0;};
export function duration(s:PhaseSettings,p:Phase,random=Math.random){const d=s.duration[p];return (s.randomDuration?d.min+Math.floor(unit(random)*(d.max-d.min+1)):d.seconds)*1000;}
export function instructionPool(s:PhaseSettings,p:Phase){
 const scope=selectedScope(s),custom=s.prompts.filter(x=>(promptScope(x.id)==='default'||scope!=='default'&&promptScope(x.id)===scope)&&(x.phase==='all'||x.phase===p));
 const choices=custom.length?custom:baseInstructions.filter(x=>x.phase===p).map(x=>({...x,id:'builtin:'+x.id}));
 const seen=new Set<string>();return choices.filter(x=>{const text=normalizedInstruction(x.text);if(seen.has(text))return false;seen.add(text);return true;});
}
function draw(s:PhaseSettings,p:Phase,draws:PhaseSession['draws']={},random=Math.random){
 const pool=instructionPool(s,p),scope=selectedScope(s),previous=draws?.[p],ids=new Set(pool.map(x=>x.id));let used=previous?.scope===scope?previous.used.filter(id=>ids.has(id)):[];
 let available=pool.filter(x=>!used.includes(x.id));if(!available.length){used=[];available=pool.filter(x=>pool.length===1||x.id!==previous?.lastId);}
 const item=available[Math.floor(unit(random)*available.length)];
 return {text:item?.text??'当前阶段：'+phaseNames[p]+'。',draws:{...draws,[p]:{scope,used:item?[...used,item.id]:used,...(item?{lastId:item.id}:{})}}};
}
export function prompt(s:PhaseSettings,p:Phase,random=Math.random){return draw(s,p,{},random).text;}
export function initial(s:PhaseSettings):PhaseSession{const total=(s.gameMinutes??10)*60000;return {status:'idle',phase:'red',remainingMs:s.duration.red.seconds*1000,step:0,prompt:'',gameDurationMs:total,gameRemainingMs:total,elapsedMs:0,draws:{}};}
export function start(s:PhaseSettings,random=Math.random):PhaseSession{const picked=draw(s,'red',{},random);return {...initial(s),status:'running',remainingMs:duration(s,'red',random),step:1,prompt:picked.text,draws:picked.draws};}
export function next(s:PhaseSettings,r:PhaseSession,random=Math.random):PhaseSession{
 if(!['running','paused'].includes(r.status)||(r.gameRemainingMs??1)<=0)return r;
 const candidates=phases.filter(p=>p!==r.phase),phase=s.mode==='sequence'?phases[(phases.indexOf(r.phase)+1)%3]:candidates[Math.floor(unit(random)*candidates.length)],picked=draw(s,phase,r.draws,random);
 return {...r,phase,remainingMs:duration(s,phase,random),step:r.step+1,prompt:picked.text,draws:picked.draws};
}
/** Foreground active time only. At the deadline there is no extra draw or transition. */
export function advance(s:PhaseSettings,r:PhaseSession,elapsed:number,random=Math.random):PhaseSession{
 if(r.status!=='running'||!Number.isFinite(elapsed)||elapsed<=0)return r;
 const remaining=r.gameRemainingMs??(s.gameMinutes??10)*60000,consumed=Math.min(elapsed,remaining);let result={...r},left=consumed;
 while(left>=result.remainingMs){if(left===result.remainingMs&&consumed===remaining)break;left-=result.remainingMs;result=next(s,result,random);}
 const gameRemainingMs=Math.max(0,remaining-consumed),elapsedMs=(r.elapsedMs??0)+consumed;
 return {...result,status:gameRemainingMs===0?'finished':'running',remainingMs:gameRemainingMs===0?0:Math.max(0,result.remainingMs-left),gameRemainingMs,elapsedMs};
}
export function bpmAt(s:PhaseSettings,elapsedMs:number){const max=Math.max(s.bpm,s.maxBpm??120);return s.autoAccelerate?s.bpm+(max-s.bpm)*Math.min(1,Math.max(0,elapsedMs)/((s.accelerationSeconds??120)*1000)):s.bpm;}
function beatPosition(s:PhaseSettings,time:number){const t=Math.max(0,time),a=(s.accelerationSeconds??120)*1000,max=Math.max(s.bpm,s.maxBpm??120);if(!s.autoAccelerate)return s.bpm*t/60000;const before=Math.min(t,a);return (s.bpm*before+(max-s.bpm)*before*before/(2*a)+Math.max(0,t-a)*max)/60000;}
export function beatsBetween(s:PhaseSettings,from:number,to:number){return Math.max(0,Math.floor(beatPosition(s,to)+1e-9)-Math.floor(beatPosition(s,from)+1e-9));}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const number=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const validPrompt=(p:unknown):p is Prompt=>object(p)&&typeof p.id==='string'&&p.id.length>0&&p.id.length<=1000&&['all',...phases].includes(String(p.phase))&&typeof p.text==='string'&&p.text.trim().length>0&&p.text.length<=1000;
export function validData(x:unknown):x is PhaseData{
 if(!object(x)||x.version!==1||!object(x.settings)||!object(x.session)||x.revision!==undefined&&(typeof x.revision!=='string'||x.revision.length>100))return false;
 const s=x.settings,r=x.session;
 if(!['sequence','random'].includes(String(s.mode))||!object(s.duration)||!number(s.bpm,30,180)||!number(s.volume,0,1)||!['randomDuration','beat','sound','vibration'].every(k=>typeof s[k]==='boolean'))return false;
 for(const p of phases){const d=s.duration[p];if(!object(d)||!number(d.seconds,1,600)||!number(d.min,1,600)||!number(d.max,1,600)||Number(d.min)>Number(d.max))return false;}
 if(!Array.isArray(s.prompts)||s.prompts.length>libraryLimits.total||!s.prompts.every(validPrompt)||new Set(s.prompts.map(p=>p.id)).size!==s.prompts.length)return false;
 const counts=new Map<string,number>();for(const p of s.prompts){const key=promptScope(p.id),count=(counts.get(key)??0)+1;if(count>libraryLimits.perScope)return false;counts.set(key,count);}
 if(x.libraryVersions!==undefined){if(!object(x.libraryVersions)||Object.keys(x.libraryVersions).length>200)return false;for(const [scope,rows] of Object.entries(x.libraryVersions)){if(!Array.isArray(rows)||rows.length>libraryLimits.history||!rows.every(v=>object(v)&&number(v.savedAt,0,1e16)&&Array.isArray(v.prompts)&&v.prompts.length<=libraryLimits.perScope&&v.prompts.every(p=>validPrompt(p)&&promptScope(p.id)===scope)&&new Set(v.prompts.map((p:Prompt)=>p.id)).size===v.prompts.length))return false;}}
 if((s.sweetMode!==undefined&&typeof s.sweetMode!=='boolean')||(s.commandMode!==undefined&&typeof s.commandMode!=='boolean')||(s.address!==undefined&&(typeof s.address!=='string'||s.address.length>60))||(s.intensity!==undefined&&!['soft','medium','strong','dramatic'].includes(String(s.intensity))))return false;
 if(s.instructionMode!==undefined&&!['default','character'].includes(String(s.instructionMode))||s.instructionCharacterId!==undefined&&(typeof s.instructionCharacterId!=='string'||s.instructionCharacterId.length>1000))return false;
 if(s.instructionWorldId!==undefined&&(typeof s.instructionWorldId!=='string'||s.instructionWorldId.length>1000))return false;
 if(s.autoAccelerate!==undefined&&typeof s.autoAccelerate!=='boolean'||s.maxBpm!==undefined&&!number(s.maxBpm,30,180)||s.accelerationSeconds!==undefined&&!number(s.accelerationSeconds,10,3600)||s.gameMinutes!==undefined&&!number(s.gameMinutes,1,180))return false;
 if(r.gameRemainingMs!==undefined&&!number(r.gameRemainingMs,0,10800000)||r.elapsedMs!==undefined&&!number(r.elapsedMs,0,10800000)||r.gameDurationMs!==undefined&&!number(r.gameDurationMs,1,10800000))return false;
 if(r.draws!==undefined){if(!object(r.draws)||Object.keys(r.draws).some(k=>!phases.includes(k as Phase)))return false;for(const bag of Object.values(r.draws)){if(!object(bag)||typeof bag.scope!=='string'||bag.scope.length>3000||!Array.isArray(bag.used)||bag.used.length>2000||!bag.used.every(id=>typeof id==='string'&&id.length<=1000)||new Set(bag.used).size!==bag.used.length||bag.lastId!==undefined&&(typeof bag.lastId!=='string'||bag.lastId.length>1000))return false;}}
 return ['idle','running','paused','finished'].includes(String(r.status))&&phases.includes(r.phase as Phase)&&number(r.remainingMs,0,600000)&&Number.isInteger(r.step)&&number(r.step,0,1e9)&&typeof r.prompt==='string'&&r.prompt.length<=1000;
}
