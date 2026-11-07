import {storyLimits} from './storyTypes';
export type StoryResponseCode='response-too-long'|'empty-response'|'json-invalid'|'json-incomplete'|'json-ambiguous'|'root-shape'|'body-invalid'|'choice-count'|'choice-shape'|'choice-label'|'choice-text'|'choice-duplicate'|'truncated'|'blocked'|'envelope-invalid';
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
function jsonValue(raw:string):any {
 const text=raw.trim().replace(/^\uFEFF/,'');if(!text)fail('empty-response');
 try{return JSON.parse(text);}catch{/* Only extract a single complete JSON object; never repair invalid JSON. */}
 const objects:{start:number;end:number}[]=[];let start=-1,depth=0,quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(start<0){if(ch==='{'){start=i;depth=1;}continue;}
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&!--depth){objects.push({start,end:i+1});start=-1;}
 }
 if(start>=0)fail('json-incomplete');if(objects.length>1)fail('json-ambiguous');if(objects.length!==1)fail('json-invalid');
 const obj=objects[0];if(/[{}\[\]]/.test(text.slice(0,obj.start)+text.slice(obj.end)))fail('json-invalid');
 try{return JSON.parse(text.slice(obj.start,obj.end));}catch{fail('json-invalid');}
}
/** Canonicalize explicit A/B/C/D labels only. No body/choice synthesis or partial acceptance. */
export function parseStoryReply(raw:string){
 if(raw.length>storyLimits.outputChars)fail('response-too-long',{responseCharacters:raw.length});
 const x=jsonValue(raw),object=(o:any)=>o&&typeof o==='object'&&!Array.isArray(o);
 if(!object(x)||Object.keys(x).some(k=>!['body','choices'].includes(k)))fail('root-shape');
 if(typeof x.body!=='string'||!x.body.trim()||x.body.length>storyLimits.body)fail('body-invalid',{missingBody:!Object.hasOwn(x,'body')});
 if(!Array.isArray(x.choices)||x.choices.length!==4)fail('choice-count',{missingChoices:!Object.hasOwn(x,'choices'),...(Array.isArray(x.choices)?{choiceCount:x.choices.length}:{})});
 const label=(v:unknown)=>typeof v==='string'?v.normalize('NFKC').trim().toUpperCase():'';
 const choices=x.choices.map((c:any)=>{
  if(!object(c)||Object.keys(c).some(k=>!['id','label','text'].includes(k)))fail('choice-shape');
  const id=label(c.id??c.label);if(!/^[ABCD]$/.test(id)||c.id!==undefined&&c.label!==undefined&&label(c.id)!==label(c.label))fail('choice-label');
  if(typeof c.text!=='string'||!c.text.trim()||c.text.length>storyLimits.choice)fail('choice-text');return {id:id as 'A'|'B'|'C'|'D',text:c.text};
 });
 if(new Set(choices.map((c:{id:string})=>c.id)).size!==4)fail('choice-label');
 if(new Set(choices.map((c:{text:string})=>c.text.trim())).size!==4)fail('choice-duplicate');
 return {body:x.body as string,choices:choices.sort((a:{id:string},b:{id:string})=>a.id.localeCompare(b.id))} as {body:string;choices:{id:'A'|'B'|'C'|'D';text:string}[]};
}
