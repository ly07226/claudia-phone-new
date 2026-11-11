import type {StoryPerspective} from './scriptTypes';
import {validateWizardSuggestions,type WizardSuggestions} from './wizardAssistanceTypes';
import type {StoryLength} from './storyTypes';
import type {UserIdentity} from './userIdentity';
export const wizardLimits={title:80,synopsis:10000,rules:4000,direction:4000,opening:6000,profile:4000,fileBytes:20*1024*1024};
export const wizardPaces={slow:'慢热',balanced:'均衡',compact:'紧凑',custom:'自定义'} as const;
export interface WizardIdentity {name:string;gender:string;appearance:string;personality:string;occupation:string;experience:string;bio:string;customSetting:string;age?:string|number;avatar?:string}
export interface WizardCharacter {worldSetting?:string;name:string;persona:string;speakingStyle:string}
export interface ScriptWizardDraft {
 suggestions?:WizardSuggestions;aiCharacterRequirements?:string;
 background?:string;perspective?:StoryPerspective;longSourceId?:string;longSourceName?:string;
 creationToken?:string;createdWorldId?:string;length?:StoryLength;
 version:1;step:number;title:string;synopsis:string;rules:string;direction:string;pace:keyof typeof wizardPaces;customPace:string;
 identity:WizardIdentity;identitySource?:string;characterIds:string[];customCharacters:WizardCharacter[];opening:string;confirmed:boolean;
}
export const emptyWizardIdentity=():WizardIdentity=>({name:'',gender:'',appearance:'',personality:'',occupation:'',experience:'',bio:'',customSetting:''});
export const newWizardDraft=():ScriptWizardDraft=>({version:1,perspective:'second',creationToken:crypto.randomUUID(),length:'standard',step:0,title:'',synopsis:'',rules:'',direction:'',pace:'balanced',customPace:'',identity:emptyWizardIdentity(),characterIds:[],customCharacters:[],opening:'',confirmed:false});
/** Explicitly copy static identity fields only. Never copy chat, memory or credentials. */
export function copyWizardIdentity(identity:UserIdentity):WizardIdentity {
 const next=emptyWizardIdentity();for(const key of Object.keys(next) as (keyof typeof next)[])if(typeof identity[key]==='string')Object.assign(next,{[key]:identity[key]});
 if(typeof identity.age==='number'||typeof identity.age==='string')next.age=identity.age;
 if(typeof identity.avatar==='string')next.avatar=identity.avatar;
 return next;
}
const text=(x:unknown,max:number)=>typeof x==='string'&&x.length<=max;
export function validateWizardDraft(value:unknown):asserts value is ScriptWizardDraft {
 const x=value as ScriptWizardDraft;
 if(x?.perspective!==undefined&&!['first','second','third'].includes(x.perspective))throw Error('叙事人称配置无效。');
 if(x?.longSourceId!==undefined&&!text(x.longSourceId,80)||x?.longSourceName!==undefined&&!text(x.longSourceName,255))throw Error('长篇来源引用无效。');
 if(x?.background!==undefined&&!text(x.background,6000))throw Error('世界背景最多6000字符。');
 if(x?.suggestions!==undefined)validateWizardSuggestions(x.suggestions,true);if(x?.aiCharacterRequirements!==undefined&&!text(x.aiCharacterRequirements,2000))throw Error('角色补充要求过长。');
 if(x?.creationToken!==undefined&&(typeof x.creationToken!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(x.creationToken))||x?.createdWorldId!==undefined&&!text(x.createdWorldId,2000)||x?.length!==undefined&&!['brief','standard','detailed'].includes(x.length))throw Error('创作草稿标识或篇幅无效。');
 if(!x||x.version!==1||!Number.isInteger(x.step)||x.step<0||x.step>4||typeof x.confirmed!=='boolean'||!Object.hasOwn(wizardPaces,x.pace))throw Error('草稿版本或结构无效。');
 for(const [k,max] of Object.entries({title:80,synopsis:10000,rules:4000,direction:4000,customPace:1000,opening:6000}))if(!text(x[k as keyof ScriptWizardDraft],max))throw Error('草稿文本超出限制。');
 if(!x.identity||typeof x.identity!=='object')throw Error('主控资料无效。');
 for(const key of Object.keys(emptyWizardIdentity()))if(!text(x.identity[key as keyof WizardIdentity],key==='name'?80:4000))throw Error('主控资料无效。');
 if(x.identitySource!==undefined&&!text(x.identitySource,2100))throw Error('身份来源无效。');
 if(x.identity.avatar!==undefined&&!text(x.identity.avatar,2000))throw Error('头像引用无效。');
 if(x.identity.age!==undefined&&!(typeof x.identity.age==='number'&&Number.isFinite(x.identity.age))&&!text(x.identity.age,80))throw Error('年龄无效。');
 if(!Array.isArray(x.characterIds)||x.characterIds.length>20||x.characterIds.some(id=>!text(id,2000))||new Set(x.characterIds).size!==x.characterIds.length)throw Error('角色引用无效。');
 if(!Array.isArray(x.customCharacters)||x.customCharacters.length>10||x.customCharacters.some(c=>!c||!text(c.name,80)||!text(c.persona,4000)||!text(c.speakingStyle,4000)||c.worldSetting!==undefined&&!text(c.worldSetting,4000)))throw Error('自定义角色无效。');
}
export function wizardStepError(d:ScriptWizardDraft,step:number,available:Set<string>):string {
 if(step===0&&(!d.title.trim()||!d.synopsis.trim()||d.pace==='custom'&&!d.customPace.trim()))return '请填写故事标题、梗概和自定义节奏（如适用）。';
 if(step===1&&!d.identity.name.trim())return '请填写主控姓名。';
 if(step===2){if(!d.characterIds.length&&!d.customCharacters.length)return '请至少选择或创建一名主要角色。';
  if(d.characterIds.some(id=>!available.has(id)))return '已选角色已被移除，请重新选择。';
  if(d.customCharacters.some(c=>!c.name.trim()))return '请填写自定义角色姓名。';}
 if(step===3&&!d.opening.trim())return '请填写开场场景。';
 return '';
}
/** File import only populates narrative draft; no World, lorebook or database writes. */
export function parseWizardFile(name:string,body:string):Partial<ScriptWizardDraft> {
 if(/\.(txt|md)$/i.test(name)){if(!body.trim()||body.length>wizardLimits.synopsis)throw Error('剧情文本为空或超过 10000 字符。');return {synopsis:body};}
 if(!/\.json$/i.test(name))throw Error('仅支持 TXT、MD 或已验证的 JSON。');
 let x:any;try{x=JSON.parse(body);}catch{throw Error('JSON 语法无效。');}
 if(!x||Array.isArray(x)||x.version!==1||Object.keys(x).some(k=>!['version','title','synopsis','rules','direction'].includes(k))||!text(x.synopsis,10000)||!x.synopsis.trim())throw Error('JSON 需包含 version:1 和 synopsis，仅允许 title、rules、direction 作为可选字段。');
 const result:Partial<ScriptWizardDraft>={synopsis:x.synopsis};for(const key of ['title','rules','direction'] as const)if(x[key]!==undefined){if(!text(x[key],wizardLimits[key]))throw Error('JSON 字段类型或长度无效。');result[key]=x[key];}return result;
}
export function wizardDraftKey(databaseName:string){return `claudia.script-wizard.v1:${databaseName}`;}
export function loadWizardDraft(storage:Storage,key:string){
 const raw=storage.getItem(key);if(!raw)return {draft:newWizardDraft(),raw:null};
 const parsed:unknown=JSON.parse(raw);validateWizardDraft(parsed);return {draft:parsed,raw};
}
