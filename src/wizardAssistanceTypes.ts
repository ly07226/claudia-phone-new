export interface PacingRecommendation {title:string;description:string;pace:'slow'|'balanced'|'compact'}
export interface OpeningRecommendation {title:string;timeAndPlace:string;conflict:string;connection:string}
export interface GeneratedWizardCharacter {name:string;gender:string;appearance:string;personality:string;identity:string;background:string;relationship:string}
export interface WizardSuggestions {pacing?:PacingRecommendation[];opening?:OpeningRecommendation[];character?:GeneratedWizardCharacter}
export type WizardAssistanceKind='pacing'|'opening'|'character';
export interface WizardSuggestionResults {pacing:PacingRecommendation[];opening:OpeningRecommendation[];character:GeneratedWizardCharacter}
export const characterFields=[['name','姓名',80],['gender','性别',80],['appearance','外貌',600],['personality','性格',600],['identity','身份',600],['background','背景经历',1000],['relationship','与主控的关系',600]] as const;
function check(ok:unknown):asserts ok{if(!ok)throw Error('AI 推荐格式或字段无效，原输入保持不变。');}
const text=(x:unknown,max:number)=>typeof x==='string'&&!!x.trim()&&x.length<=max;
const keys=(x:unknown,list:string[])=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===list.sort().join();
export function validateWizardSuggestions(value:unknown,editing=false):asserts value is WizardSuggestions {
 const s=value as WizardSuggestions;check(s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).every(k=>['pacing','opening','character'].includes(k)));
 if(s.pacing!==undefined){check(Array.isArray(s.pacing)&&s.pacing.length===3);for(const r of s.pacing)check(keys(r,['title','description','pace'])&&text(r.title,80)&&text(r.description,800)&&['slow','balanced','compact'].includes(r.pace));check(new Set(s.pacing.map(r=>r.title.trim())).size===3&&new Set(s.pacing.map(r=>r.description.trim())).size===3);}
 if(s.opening!==undefined){check(Array.isArray(s.opening)&&s.opening.length===3);for(const r of s.opening)check(keys(r,['title','timeAndPlace','conflict','connection'])&&text(r.title,80)&&text(r.timeAndPlace,600)&&text(r.conflict,600)&&text(r.connection,600));check(new Set(s.opening.map(r=>r.title.trim())).size===3&&new Set(s.opening.map(r=>[r.timeAndPlace.trim(),r.conflict.trim(),r.connection.trim()].join('|'))).size===3);}
 if(s.character!==undefined){check(keys(s.character,characterFields.map(([key])=>key)));for(const [key,,limit] of characterFields)check(typeof s.character[key]==='string'&&s.character[key].length<=limit&&(editing||s.character[key].trim()));}
}
export function parseWizardRecommendation<K extends WizardAssistanceKind>(kind:K,raw:string):WizardSuggestionResults[K]{
 check(raw.length<=16000);let value:any;try{value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));}catch{throw Error('AI 返回的 JSON 无法解析，原输入保持不变。');}
 const field=kind==='character'?'character':'recommendations';check(keys(value,[field]));const result=value[field];validateWizardSuggestions({[kind]:result});return result;
}
export function wizardCharacterPersona(c:GeneratedWizardCharacter){return characterFields.filter(([key])=>key!=='name'&&key!=='relationship').map(([key,label])=>`${label}：${c[key]}`).join('\n');}
const str={type:'STRING'};
export const wizardAssistanceSchemas={
 pacing:{type:'OBJECT',properties:{recommendations:{type:'ARRAY',minItems:3,maxItems:3,items:{type:'OBJECT',properties:{title:str,description:str,pace:{type:'STRING',enum:['slow','balanced','compact']}},required:['title','description','pace']}}},required:['recommendations']},
 opening:{type:'OBJECT',properties:{recommendations:{type:'ARRAY',minItems:3,maxItems:3,items:{type:'OBJECT',properties:{title:str,timeAndPlace:str,conflict:str,connection:str},required:['title','timeAndPlace','conflict','connection']}}},required:['recommendations']},
 character:{type:'OBJECT',properties:{character:{type:'OBJECT',properties:Object.fromEntries(characterFields.map(([key])=>[key,str])),required:characterFields.map(([key])=>key)}},required:['character']}
};
