import {validateRuntimeConfig,validateRuntimeState,type DocumentRuntimeConfig} from './wizardRuntimeConfig';
import {applySimulatorChanges,type SimulatorStateChange,type SimulatorValue} from './wizardSimulatorState';
export interface AutomaticMechanics {
 fields?:{key:string;label:string;type:'number'|'string'|'boolean';initial:SimulatorValue;min?:number;max?:number;readOnly?:boolean;quote:string}[];
 events?:{id:string;when:{key:string;op:'eq'|'gte'|'lte';value:SimulatorValue};changes:SimulatorStateChange[];quote:string}[];
}
export const automaticReviewPrompt=`本次为自动全文准备，无人工审核。按段落完整识别，不用开头代表全文；最多64条。quote引用完整段落，包含条件、时间、否定。秘密整段标secret；knownBy只列原文明示且出现在quote中的知情者，playerKnown只在原文明示玩家已知时为true。秘密可选revealWhen:{key:状态键,equals:值}，仅在原文明示该状态等于某值时向玩家公开信息才填写，不推测揭示时机。不把人物背景或计划视为已经发生的事件。不确定用uncertain，未来用planned。可额外返回mechanics:{fields:[{key:英文键,label:原文变量名称,type:number|string|boolean,initial:明确初值,min:可选,max:可选,readOnly:可选,quote:完整原文}],events:[{id:英文唯一键,when:{key,op:eq|gte|lte,value},changes:[{key,op:set|increment,value}],quote:完整原文}]}。只提取原文明示初值和确定的条件状态事件；数值、变量名及完整条件必须在quote中有依据。不编造机制，不确定或涉及秘密的机制不编译；普通背景不生成mechanics。相对行动消耗等复杂语义作为原文规则保留，不假造可执行公式。`;
const hasValue=(quote:string,value:unknown)=>typeof value==='number'?Number.isFinite(value)&&(quote.match(/-?\d+(?:\.\d+)?/g)??[]).some(n=>Number(n)===value):typeof value==='boolean'?quote.includes(String(value)):typeof value==='string'&&!!value&&quote.includes(value);
/** A small declarative interpreter, never JS/eval or inferred numeric defaults. */
function explicitInitial(f:NonNullable<AutomaticMechanics['fields']>[number]){
 const tail=f.quote.slice(f.quote.indexOf(f.label)+f.label.length).split(/[。；;\n]/)[0];
 const m=tail.match(/初始(?:状态|值)?\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?|true|false|“[^”]+”|"[^"]+"|‘[^’]+’)/i);
 if(!m)return false;const raw=m[1];return typeof f.initial==='number'?Number(raw)===f.initial:typeof f.initial==='boolean'?raw===String(f.initial):raw.slice(1,-1)===f.initial;
}
function explicitBounds(f:NonNullable<AutomaticMechanics['fields']>[number]){const m=f.quote.match(/范围\s*(-?\d+(?:\.\d+)?)\s*(?:到|至|～|~)\s*(-?\d+(?:\.\d+)?)/);return m?f.min===Number(m[1])&&f.max===Number(m[2]):f.min===undefined&&f.max===undefined;}
function afterLabel(quote:string,label:string){const tails:string[]=[];let at=quote.indexOf(label);while(label&&at>=0){tails.push(quote.slice(at+label.length).trimStart());at=quote.indexOf(label,at+label.length);}return tails;}
function anchoredValue(quote:string,label:string,expression:RegExp,value:SimulatorValue){return afterLabel(quote,label).some(t=>{const m=t.match(expression);if(!m)return false;const raw=m[1];return typeof value==='number'?Number(raw)===value:typeof value==='boolean'?raw===String(value):raw.replace(/^[“"‘]|[”"’]$/g,'')===value;});}
const literal='(-?\\d+(?:\\.\\d+)?|true|false|“[^”]+”|"[^"]+"|‘[^’]+’)';
export function conditionEvidence(quote:string,label:string,op:string,value:SimulatorValue){const operators:Record<string,string>={gte:'(?:达到|不少于|大于等于|>=)',lte:'(?:不超过|不多于|小于等于|<=)',eq:'(?:恰好|等于|为|==)'};return !!operators[op]&&anchoredValue(quote,label,new RegExp('^'+operators[op]+'\\s*'+literal),value);}
function changeEvidence(quote:string,label:string,c:SimulatorStateChange){if(c.value===undefined)return false;if(c.op==='set')return anchoredValue(quote,label,new RegExp('^(?:设置为?|变为|=)\\s*'+literal),c.value);if(c.op==='increment'&&typeof c.value==='number')return anchoredValue(quote,label,new RegExp(c.value<0?'^(?:减少|消耗|扣除)\\s*'+literal:'^(?:增加|增长)\\s*'+literal),Math.abs(c.value));return false;}
export function compileAutomaticMechanics(parts:{text:string;mechanics?:AutomaticMechanics}[]){
 const fields:NonNullable<AutomaticMechanics['fields']>=[],events:NonNullable<AutomaticMechanics['events']>=[];let deferred=0;
 for(const p of parts){const m=p.mechanics;if(!m)continue;if(typeof m!=='object'||!Array.isArray(m.fields??[])||!Array.isArray(m.events??[])||(m.fields?.length??0)>100||(m.events?.length??0)>100){deferred++;continue;}
  for(const f of m.fields??[]){if(!f||typeof f.quote!=='string'||!f.quote.trim()||!p.text.includes(f.quote)||typeof f.label!=='string'||!f.label||!f.quote.includes(f.label)||/秘密|隐瞒|未公开|如果|除非|只有|假如/.test(f.quote)||!hasValue(f.quote,f.initial)||!explicitInitial(f)||!explicitBounds(f)||f.readOnly===true&&!/只读|不可(?:直接)?修改/.test(f.quote)||[f.min,f.max].some(v=>v!==undefined&&!hasValue(f.quote,v))){deferred++;continue;}fields.push(f);}
  for(const e of m.events??[]){if(!e||typeof e.quote!=='string'||!e.quote.trim()||!p.text.includes(e.quote)||/秘密|隐瞒|未公开|并且|同时|而且|且|或|除非|只有|允许|可以|选择|决定|尝试|愿意|同意/.test(e.quote)||!e.when||typeof e.when!=='object'||!hasValue(e.quote,e.when.value)||!((e.when.op==='gte'&&/达到|不少于|大于等于|>=/.test(e.quote))||(e.when.op==='lte'&&/不超过|不多于|小于等于|<=/.test(e.quote))||(e.when.op==='eq'&&/恰好|等于|为/.test(e.quote)))||!Array.isArray(e.changes)||e.changes.some(c=>!c||typeof c!=='object'||!hasValue(e.quote,c.value))){deferred++;continue;}events.push(e);}
 }
 const config:DocumentRuntimeConfig={initial:{},fields:{},events:[]};
 const meaning=(f:typeof fields[number])=>JSON.stringify([f.label,f.type,f.initial,f.min,f.max,!!f.readOnly]);
 const conflicts=new Set(fields.filter((f,i)=>fields.some((g,j)=>i!==j&&g.key===f.key&&meaning(g)!==meaning(f))).map(f=>f.key));
 const eventConflicts=new Set(events.flatMap((e,i)=>events.some((other,j)=>j!==i&&JSON.stringify([other.when.key,other.when.op,other.when.value])===JSON.stringify([e.when.key,e.when.op,e.when.value])&&other.changes.some(a=>e.changes.some(b=>a.key===b.key&&(a.op!==b.op||a.value!==b.value))))?[e.id]:[]));
 for(const f of fields){if(conflicts.has(f.key)){deferred++;continue;}const {key,label,type,initial,min,max,readOnly}=f;const field={type,label,...(min===undefined?{}:{min}),...(max===undefined?{}:{max}),...(readOnly===undefined?{}:{readOnly})};const next={...config,initial:{...config.initial,[key]:initial},fields:{...config.fields,[key]:field}};try{validateRuntimeConfig(next);Object.assign(config,next);}catch{deferred++;}}
 for(const e of events){if(eventConflicts.has(e.id)){deferred++;continue;}if(config.events.some(x=>x.id===e.id)){deferred++;continue;}if(!conditionEvidence(e.quote,config.fields[e.when.key]?.label??'\u0000',e.when.op,e.when.value)||e.changes.some(c=>!changeEvidence(e.quote,config.fields[c.key]?.label??'\u0000',c))){deferred++;continue;}const {id,when,changes}=e,next={...config,events:[...config.events,{id,when,changes}]};try{validateRuntimeConfig(next);validateRuntimeState(applySimulatorChanges(next.initial,changes),next);config.events=next.events;}catch{deferred++;}}
 return {runtime:Object.keys(config.fields).length?config:undefined,deferred};
}
