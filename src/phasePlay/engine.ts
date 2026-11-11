import {pickInstruction} from './instructions';
export const phases=['red','yellow','green'] as const;
export type Phase=typeof phases[number];
export const phaseNames:Record<Phase,string>={red:'红灯',yellow:'黄灯',green:'绿灯'};
export interface Prompt {id:string;phase:Phase|'all';text:string}
export interface PhaseSettings {mode:'sequence'|'random';randomDuration:boolean;duration:Record<Phase,{seconds:number;min:number;max:number}>;bpm:number;beat:boolean;sound:boolean;volume:number;vibration:boolean;prompts:Prompt[];sweetMode?:boolean;commandMode?:boolean;address?:string;intensity?:'soft'|'medium'|'strong'|'dramatic';instructionMode?:'default'|'character';instructionCharacterId?:string;instructionWorldId?:string}
export interface PhaseSession {status:'idle'|'running'|'paused';phase:Phase;remainingMs:number;step:number;prompt:string}
export interface PhaseData {version:1;settings:PhaseSettings;session:PhaseSession}
export function defaults():PhaseSettings{return {mode:'sequence',randomDuration:false,duration:{red:{seconds:5,min:3,max:8},yellow:{seconds:15,min:10,max:20},green:{seconds:60,min:40,max:80}},bpm:60,beat:true,sound:false,volume:.2,vibration:false,prompts:[],sweetMode:false,commandMode:false,address:'',intensity:'medium',instructionMode:'default',instructionCharacterId:'',instructionWorldId:''};}
export function duration(s:PhaseSettings,p:Phase,random=Math.random){const d=s.duration[p];return (s.randomDuration?d.min+Math.floor(random()*(d.max-d.min+1)):d.seconds)*1000;}
export function prompt(s:PhaseSettings,p:Phase,random=Math.random){const choices=s.instructionMode==='character'?s.prompts.filter(x=>x.id.startsWith('character:'+encodeURIComponent(s.instructionCharacterId??'')+':'+encodeURIComponent(s.instructionWorldId??'')+':')&&(x.phase==='all'||x.phase===p)):s.prompts.filter(x=>!x.id.startsWith('character:')&&(x.phase==='all'||x.phase===p));if(choices.length)return choices[Math.floor(random()*choices.length)].text;
 const base=pickInstruction(p,{},random)?.text??('当前阶段：'+phaseNames[p]+'。');
 const address=(s.address??'').trim().slice(0,30),lead=address?address+'，':'';
 if(s.commandMode){const words:Record<Phase,string>={red:'停。等我说继续。',yellow:'慢一点，注意信号。',green:'很好，照着提示继续。'};return lead+(s.intensity==='soft'?'听我说，':'')+words[p];}
 if(s.sweetMode){const words:Record<Phase,string>={red:'乖，先停一下。下一次信号到了再继续。',yellow:'不着急，慢慢来。',green:'很好，就这样，按你舒服的节奏来。'};return lead+words[p];}
 return base;}
export function initial(s:PhaseSettings):PhaseSession{return {status:'idle',phase:'red',remainingMs:s.duration.red.seconds*1000,step:0,prompt:''};}
export function start(s:PhaseSettings,random=Math.random):PhaseSession{return {status:'running',phase:'red',remainingMs:duration(s,'red',random),step:1,prompt:prompt(s,'red',random)};}
export function next(s:PhaseSettings,r:PhaseSession,random=Math.random):PhaseSession{const candidates=phases.filter(p=>p!==r.phase);const phase=s.mode==='sequence'?phases[(phases.indexOf(r.phase)+1)%3]:candidates[Math.floor(random()*candidates.length)];return {...r,phase,remainingMs:duration(s,phase,random),step:r.step+1,prompt:prompt(s,phase,random)};}
/** Consume elapsed foreground time, including a partial tick; no dependence on chunk boundaries. */
export function advance(s:PhaseSettings,r:PhaseSession,elapsed:number,random=Math.random):PhaseSession{
 if(r.status!=='running'||!Number.isFinite(elapsed)||elapsed<=0)return r;
 let result={...r},left=elapsed; // The UI pauses on suspension before calling this foreground-only function.
 while(left>=result.remainingMs){left-=result.remainingMs;result=next(s,result,random);}
 return {...result,remainingMs:result.remainingMs-left};
}
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const number=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
export function validData(x:unknown):x is PhaseData{
 if(!object(x)||x.version!==1||!object(x.settings)||!object(x.session))return false;
 const s=x.settings,r=x.session;
 if(!['sequence','random'].includes(String(s.mode))||!object(s.duration)||!number(s.bpm,30,180)||!number(s.volume,0,1)||!['randomDuration','beat','sound','vibration'].every(k=>typeof s[k]==='boolean'))return false;
 for(const p of phases){const d=s.duration[p];if(!object(d)||!number(d.seconds,1,600)||!number(d.min,1,600)||!number(d.max,1,600)||Number(d.min)>Number(d.max))return false;}
 if(!Array.isArray(s.prompts)||s.prompts.length>100||!s.prompts.every(p=>object(p)&&typeof p.id==='string'&&p.id.length<=240&&['all',...phases].includes(String(p.phase))&&typeof p.text==='string'&&p.text.trim().length>0&&p.text.length<=1000))return false;
 if(new Set(s.prompts.map(p=>p.id)).size!==s.prompts.length)return false;
 if((s.sweetMode!==undefined&&typeof s.sweetMode!=='boolean')||(s.commandMode!==undefined&&typeof s.commandMode!=='boolean')||(s.address!==undefined&&(typeof s.address!=='string'||s.address.length>60))||(s.intensity!==undefined&&!['soft','medium','strong','dramatic'].includes(String(s.intensity))))return false;
 if(s.instructionMode!==undefined&&!['default','character'].includes(String(s.instructionMode))||s.instructionCharacterId!==undefined&&(typeof s.instructionCharacterId!=='string'||s.instructionCharacterId.length>100))return false;
 if(s.instructionWorldId!==undefined&&(typeof s.instructionWorldId!=='string'||s.instructionWorldId.length>100))return false;
 return ['idle','running','paused'].includes(String(r.status))&&phases.includes(r.phase as Phase)&&number(r.remainingMs,0,600000)&&Number.isInteger(r.step)&&number(r.step,0,1e9)&&typeof r.prompt==='string'&&r.prompt.length<=1000;
}
