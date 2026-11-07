import {validateStoryParticipants} from './storyParticipants';
import type Dexie from 'dexie';
import {validateScriptConfig} from './scriptValidation';
import {storyLimits,type StoryNode,type StorySession,type StoryPreferences} from './storyTypes';
const id=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=2000;
const num=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
function check(ok:unknown):asserts ok{if(!ok)throw Error('主线数据结构、路径或世界引用无效，未忽略数据。');}
export function validateStoryPreferences(x:unknown):asserts x is StoryPreferences {check(x&&typeof x==='object'&&!Array.isArray(x)&&['brief','standard','detailed'].includes((x as StoryPreferences).length)&&Object.keys(x).every(k=>k==='length'));}
export function validateStoryNode(n:StoryNode){
 check(n&&id(n.id)&&id(n.worldId)&&id(n.sessionId)&&id(n.requestId)&&num(n.createdAt)&&num(n.sequence)&&n.sequence>0&&num(n.definitionRevision)&&n.definitionRevision>0);
 check(typeof n.body==='string'&&!!n.body.trim()&&n.body.length<=storyLimits.body&&Array.isArray(n.choices)&&n.choices.length===4);
 check(n.parentNodeId===undefined||id(n.parentNodeId));check(n.fromChoiceId===undefined||id(n.fromChoiceId));
 if(n.narrativeLength!==undefined)check(['brief','standard','detailed'].includes(n.narrativeLength));
 if(n.action!==undefined){check(n.action&&typeof n.action==='object'&&!Array.isArray(n.action));check(Object.keys(n.action).every(k=>['kind',n.action!.kind==='custom'?'text':'choiceId'].includes(k)));if(n.action.kind==='custom')check(typeof n.action.text==='string'&&!!n.action.text.trim()&&n.action.text.length<=storyLimits.action&&n.fromChoiceId===undefined&&!!n.parentNodeId);else check(n.action.kind==='choice'&&id(n.action.choiceId)&&n.action.choiceId===n.fromChoiceId&&!!n.parentNodeId);}
 n.choices.forEach((c,i)=>check(c&&c.label==='ABCD'[i]&&c.id===`${n.id}:${c.label}`&&typeof c.text==='string'&&!!c.text.trim()&&c.text.length<=storyLimits.choice));
}
export function validateStorySession(s:StorySession){
 check(s&&id(s.id)&&id(s.worldId)&&num(s.revision)&&s.revision<=storyLimits.nodes&&num(s.definitionRevision)&&s.definitionRevision>0&&['idle','generating','ready','failed'].includes(s.status)&&num(s.createdAt)&&num(s.updatedAt));
 const d=s.definition;check(d&&[d.name,d.description,d.rules,d.background].every(x=>typeof x==='string')&&d.name.length<=80&&d.description.length<=10000&&d.rules.length<=4000&&d.background.length<=6000);validateScriptConfig(d.script);if(d.participants!==undefined)validateStoryParticipants(d.participants);check(d.script.playMode==='story'&&d.script.definitionRevision===s.definitionRevision);
 check(s.headNodeId===undefined||id(s.headNodeId));check(!!s.headNodeId===(s.revision>0));check(s.status!=='ready'||!!s.headNodeId);check(s.status!=='idle'||s.revision===0);
 if(s.pending)check(id(s.pending.token)&&num(s.pending.revision)&&s.pending.revision===s.revision&&s.pending.headNodeId===s.headNodeId&&num(s.pending.expiresAt));
 check((s.status==='generating')===!!s.pending);
 if(s.actionDraft!==undefined){const d=s.actionDraft;check(d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).every(k=>['headNodeId','mode','customText','choiceId'].includes(k)));check(d.headNodeId===s.headNodeId&&id(d.headNodeId)&&['choice','custom'].includes(d.mode)&&typeof d.customText==='string'&&d.customText.length<=storyLimits.action);check(d.mode==='choice'?d.customText==='':d.choiceId===undefined);if(d.choiceId!==undefined)check(id(d.choiceId));}
 if(s.error!==undefined)check(['cancelled','request','invalid','stale','budget'].includes(s.error));
}
export async function validateStoryDatabase(d:Dexie){
 if(!d.tables.some(t=>t.name==='storySessions'))return;
 const sessions=await d.table('storySessions').toArray() as StorySession[],nodes=await d.table('storyNodes').toArray() as StoryNode[];
 const byId=new Map(nodes.map(n=>[n.id,n])),owners=new Map(sessions.map(s=>[s.id,s]));const requests=new Set<string>(),worlds=new Set<string>(),visited=new Set<string>();
 for(const s of sessions){validateStorySession(s);check(!worlds.has(s.worldId)&&await d.table('worlds').get(s.worldId));worlds.add(s.worldId);let node=s.headNodeId,count=0;const seen=new Set<string>();
  while(node){check(!seen.has(node));seen.add(node);visited.add(node);const n=byId.get(node);check(n&&n.sessionId===s.id&&n.worldId===s.worldId&&n.definitionRevision===s.definitionRevision&&n.sequence===s.revision-count);count++;node=n.parentNodeId;}
  check(count===s.revision);if(s.actionDraft?.choiceId)check(byId.get(s.headNodeId!)?.choices.some(c=>c.id===s.actionDraft!.choiceId));
 }
 for(const n of nodes){validateStoryNode(n);check(owners.has(n.sessionId)&&visited.has(n.id)&&!requests.has(n.requestId));requests.add(n.requestId);
  if(n.parentNodeId){const p=byId.get(n.parentNodeId);check(p&&p.sessionId===n.sessionId&&p.worldId===n.worldId&&(n.action?.kind==='custom'?n.fromChoiceId===undefined:p.choices.some(c=>c.id===n.fromChoiceId))&&n.sequence===p.sequence+1);}else check(n.sequence===1&&n.fromChoiceId===undefined&&n.action===undefined);
 }
}
