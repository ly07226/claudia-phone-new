import {resolveStorySegments} from './storySegments';
import {validateSimulatorChanges,type SimulatorStateChange} from './wizardSimulatorState';
import type {StorySegment} from './storyTypes';
import {storyLimits} from './storyTypes';
export type StoryResponseCode='response-too-long'|'empty-response'|'json-invalid'|'json-incomplete'|'json-ambiguous'|'root-shape'|'body-invalid'|'choice-count'|'choice-shape'|'choice-label'|'choice-text'|'choice-duplicate'|'truncated'|'blocked'|'envelope-invalid'|'envelope-shape'|'segments-invalid';
type Detail={responseCharacters?:number;choiceCount?:number;missingBody?:boolean;missingChoices?:boolean;outputTokenLimit?:number};
export class StoryResponseError extends Error {
 constructor(public readonly code:StoryResponseCode,public readonly detail:Detail={}){super('invalid');}
}
const diagnostics:({code:StoryResponseCode}&Detail)[]=[];
/** Numeric counts and fixed codes only. Never store response text, IDs or credentials. */
export function recordStoryResponseFailure(error:StoryResponseError,outputTokenLimit?:number){
 const item={code:error.code,...error.detail,...(outputTokenLimit!==undefined?{outputTokenLimit}:{})};
 diagnostics.push(item);if(diagnostics.length>20)diagnostics.shift();console.warn('[story-response]',item);
}
export function getStoryResponseDiagnostics(){return structuredClone(diagnostics);}
function fail(code:StoryResponseCode,detail:Detail={}):never{throw new StoryResponseError(code,detail);}
/** Repair syntax only: preserve every decoded text character. Never close strings/objects or invent fields. */
function readJSON(text:string):any {
 try{return JSON.parse(text);}catch{/* Deterministic, token-aware normalization below. */}
 let fixed='',quoted=false,escaped=false,last='';
 for(let i=0;i<text.length;i++){
  const c=text[i],previous=last;if(!/\s/.test(c))last=c;
  if(quoted){
   if(c.charCodeAt(0)<32){if(escaped)throw Error('ambiguous escape');fixed+=JSON.stringify(c).slice(1,-1);continue;}
   fixed+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;
  }else{
   if(c===','){let j=i+1;while(/\s/.test(text[j]??'')&&j<text.length)j++;if((text[j]===']'||text[j]==='}')&&previous&&!['[','{',',',':'].includes(previous))continue;}
   fixed+=c;if(c==='"')quoted=true;
  }
 }
 return JSON.parse(fixed);
}
function jsonValue(raw:string):any {
 const text=raw.trim().replace(/^\uFEFF/,'');if(!text)fail('empty-response');
 try{return readJSON(text);}catch{/* Extract one complete object, never repair incomplete results. */}
 const objects:{start:number;end:number}[]=[];let start=-1,depth=0,quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(start<0){if(ch==='{'){start=i;depth=1;}continue;}
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&!--depth){objects.push({start,end:i+1});start=-1;}
 }
 if(start>=0)fail('json-incomplete');if(objects.length>1)fail('json-ambiguous');if(objects.length!==1)fail('json-invalid');
 const obj=objects[0];if(/[{}\[\]]/.test(text.slice(0,obj.start)+text.slice(obj.end)))fail('json-invalid');
 try{return readJSON(text.slice(obj.start,obj.end));}catch{fail('json-invalid');}
}
/** Plain-text fallback requires four explicit, single-line labels at the end. No inferred choices. */
function labelledStory(raw:string){
 if(/^[\s]*[\[{]/.test(raw)||/"(?:body|choices)"\s*:/.test(raw))return;
 const rows=Array.from(raw.matchAll(/^[ \t]*([A-Za-zＡ-Ｚａ-ｚ])[.．、:：)）][ \t]*([^\r\n]+)\r?$/gm));
 if(rows.length!==4)return;
 for(let i=1;i<rows.length;i++)if(raw.slice(rows[i-1].index!+rows[i-1][0].length,rows[i].index).trim())return;
 if(raw.slice(rows[3].index!+rows[3][0].length).trim())return;
 const body=raw.slice(0,rows[0].index).trimEnd();if(!body.trim())return;
 return {body,choices:rows.map(row=>({id:row[1],text:row[2]}))};
}
/** Canonicalize explicit A/B/C/D labels only. No body/choice synthesis or partial acceptance. */
export function parseStoryReply(raw:string,knownSpeakers:readonly string[]=[],simulatorMode=false,fields:Record<string,{type:string}>={}){
 if(raw.length>storyLimits.outputChars)fail('response-too-long',{responseCharacters:raw.length});
 let x:any;try{x=jsonValue(raw);}catch(error){const fallback=!simulatorMode&&error instanceof StoryResponseError&&error.code==='json-invalid'?labelledStory(raw):undefined;if(!fallback)throw error;x=fallback;}
 const object=(o:any)=>o&&typeof o==='object'&&!Array.isArray(o);
 if(!object(x))fail('root-shape');
 if(typeof x.body!=='string'||!x.body.trim()||x.body.length>storyLimits.body)fail('body-invalid',{missingBody:!Object.hasOwn(x,'body')});
 const rawChoices=x.choices;
 const supplied=object(rawChoices)?Object.entries(rawChoices).map(([label,text])=>({label,text})):rawChoices;
 if(!Array.isArray(supplied)||supplied.length!==4)fail('choice-count',{missingChoices:!Object.hasOwn(x,'choices'),...(Array.isArray(supplied)?{choiceCount:supplied.length}:{})});
 const label=(v:unknown)=>typeof v==='string'?v.normalize('NFKC').trim().toUpperCase().replace(/^([ABCD])[.、:)]$/,'$1'):'';
 const choices=supplied.map((value:any)=>{
  const match=typeof value==='string'?value.match(/^\s*([A-Da-dＡ-Ｄａ-ｄ])[.．、:：)）]\s*([\s\S]+)$/):undefined;
  const c=match?{id:match[1],text:match[2]}:value;
  if(!object(c))fail('choice-shape');
  const id=label(c.id??c.label);if(!/^[ABCD]$/.test(id)||c.id!==undefined&&c.label!==undefined&&label(c.id)!==label(c.label))fail('choice-label');
  if(typeof c.text!=='string'||!c.text.trim()||c.text.length>storyLimits.choice)fail('choice-text');return {id:id as 'A'|'B'|'C'|'D',text:c.text};
 });
 if(new Set(choices.map((c:{id:string})=>c.id)).size!==4)fail('choice-label');
 if(new Set(choices.map((c:{text:string})=>c.text.trim())).size!==4)fail('choice-duplicate');
 if(simulatorMode&&Array.isArray(x.stateChanges))x.stateChanges=x.stateChanges.map((c:any)=>{if(!object(c)||typeof c.value!=='string')return c;const type=fields[c.key]?.type;if((c.op==='increment'||type==='number')&&/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(c.value))return {...c,value:Number(c.value)};if(type==='boolean'&&c.op==='set'&&['true','false'].includes(c.value))return {...c,value:c.value==='true'};return c;});
 if(simulatorMode){if(x.stateChanges===undefined)fail('root-shape');try{validateSimulatorChanges(x.stateChanges);}catch{fail('root-shape');}}
 const segments=x.segments===undefined?undefined:resolveStorySegments(x.body,x.segments,knownSpeakers);
 if(x.segments!==undefined&&!segments)recordStoryResponseFailure(new StoryResponseError('segments-invalid'));
 return {...(simulatorMode?{stateChanges:x.stateChanges as SimulatorStateChange[]}:{}),...(segments?{segments}:{}),body:x.body as string,choices:choices.sort((a:{id:string},b:{id:string})=>a.id.localeCompare(b.id))} as {stateChanges?:SimulatorStateChange[];segments?:StorySegment[];body:string;choices:{id:'A'|'B'|'C'|'D';text:string}[]};
}
