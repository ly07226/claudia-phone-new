import {readStoryParticipants} from './storyParticipants';
import {normalizeStoryAction} from './storyActions';
import {storyInput} from './storyContext';
import {db,type World} from './store';
import {validateScriptConfig} from './scriptValidation';
import {validateStoryNode,validateStorySession,validateStoryPreferences} from './storyValidation';
import {storyLimits,type StoryDefinition,type StoryNode,type StorySession,type StoryAction,type StoryDraft,type StoryLength,type StoryExpectedProgress} from './storyTypes';
export function storyDefinition(w:World):StoryDefinition {
 validateScriptConfig(w.script);if(w.script.playMode!=='story')throw Error('此世界未开启剧情模式。');
 return {name:w.name,description:w.description,rules:w.rules??'',background:w.background??'',script:structuredClone(w.script)};
}
export async function resolveStoryDefinition(w:World):Promise<StoryDefinition>{const definition=storyDefinition(w),participants=await readStoryParticipants(w);return participants?{...definition,participants}:definition;}
export const storyTables=()=>[db.worlds,db.storySessions,db.storyNodes,db.themes,db.characters,db.worldProfiles];
export async function readStoryPath(s:StorySession){
 const path:StoryNode[]=[],seen=new Set<string>();let id=s.headNodeId;
 while(id){if(seen.has(id))throw Error('主线路径循环。');seen.add(id);const n=await db.storyNodes.get(id);if(!n||n.worldId!==s.worldId||n.sessionId!==s.id||n.sequence!==s.revision-path.length)throw Error('主线路径无效。');validateStoryNode(n);path.push(n);id=n.parentNodeId;}
 if(path.length!==s.revision)throw Error('主线路径断链。');return path.reverse();
}
export interface StoryReadResult {world:World;session?:StorySession;path:StoryNode[]}
/** A view may reuse an immutable path when only its draft/settings changed.
 * Mutation/generation and default callers still resolve and validate the full path. */
export async function readStory(worldId:string,previous?:StoryReadResult):Promise<StoryReadResult>{return db.transaction('r',storyTables(),async()=>{
 const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');const session=await db.storySessions.where('worldId').equals(worldId).first();if(session)validateStorySession(session);
 const same=session&&previous?.world.id===worldId&&previous.session?.id===session.id&&previous.session.headNodeId===session.headNodeId&&previous.session.revision===session.revision;
 return {world,session,path:session?same?previous!.path:await readStoryPath(session):[]};
});}
export async function claimStory(worldId:string,actionInput:string|StoryAction|undefined,allowOldDefinition:boolean,expected?:StoryExpectedProgress,firstAttemptOnly=false){
 return db.transaction('rw',storyTables(),async()=>{
  const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');const currentDefinition=await resolveStoryDefinition(world);
  let s=await db.storySessions.where('worldId').equals(worldId).first();
  if(firstAttemptOnly&&s)throw Error('开场已有生成记录，不会自动重复调用；请检查状态并主动决定是否重试。');
  if(s?.pending&&s.pending.expiresAt>Date.now())throw Error('本世界主线正在生成，请勿重复请求。');
  if(s)validateStorySession(s);
  if(expected&&(expected.sessionId!==s?.id||expected.headNodeId!==s?.headNodeId||expected.revision!==(s?.revision??0)))throw Error('主线已在其他页面推进，请刷新并重新确认行动；未请求模型。');
  // No immutable nodes exist yet: an explicit wizard retry uses the current saved setup.
  if(s&&s.revision===0&&world.script?.creation)s={...s,definition:currentDefinition,definitionRevision:world.script.definitionRevision};
  if(s&&s.definitionRevision!==world.script!.definitionRevision&&!allowOldDefinition)throw Error('设定已变化，请确认继续使用主线开始时的设定。');
  const path=s?await readStoryPath(s):[];const head=path.at(-1),action=normalizeStoryAction(actionInput);
  const choiceId=action?.kind==='choice'?action.choiceId:undefined;
  if(head?!action||(action.kind==='choice'&&!head.choices.some(c=>c.id===action.choiceId)):action!==undefined)throw Error('选择已失效，请重新读取当前剧情。');
  if((s?.revision??0)>=storyLimits.nodes)throw Error('主线已达到安全容量上限，未删除旧节点。');
  const now=Date.now();s??={id:crypto.randomUUID(),worldId,revision:0,status:'idle',definitionRevision:world.script!.definitionRevision,definition:currentDefinition,createdAt:now,updatedAt:now};
  s={...s,status:'generating',error:undefined,updatedAt:now,pending:{token:crypto.randomUUID(),headNodeId:s.headNodeId,revision:s.revision,expiresAt:now+storyLimits.leaseMs}};
  if(action&&head)s.actionDraft=action.kind==='custom'?{headNodeId:head.id,mode:'custom',customText:action.text}:{headNodeId:head.id,mode:'choice',customText:'',choiceId:action.choiceId};
  const length=world.storyPreferences?.length??'standard';if(world.storyPreferences)validateStoryPreferences(world.storyPreferences);
  let input:string;try{input=storyInput(s,path,action,length);}catch{throw Error('世界设定或当前节点超过48000字节输入预算，未请求模型、未推进主线。请缩短设定后重试。');}
  await db.storySessions.put(s);return {session:s,path,input,action,length,choice:head?.choices.find(c=>c.id===choiceId),worldSnapshot:JSON.stringify(currentDefinition)};
 });
}

export async function saveStoryLength(worldId:string,length:StoryLength){
 validateStoryPreferences({length});
 await db.transaction('rw',db.worlds,async()=>{const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');storyDefinition(world);await db.worlds.update(worldId,{storyPreferences:{length}});});
}
export async function saveStoryDraft(worldId:string,draft:StoryDraft){
 await db.transaction('rw',db.storySessions,db.storyNodes,async()=>{
  const s=await db.storySessions.where('worldId').equals(worldId).first();
  if(!s||s.headNodeId!==draft.headNodeId||s.pending&&s.pending.expiresAt>Date.now())throw Error('当前主线已变化或正在生成，未覆盖草稿。');
  const next={...s,actionDraft:structuredClone(draft)};validateStorySession(next);
  if(draft.choiceId){const head=await db.storyNodes.get(draft.headNodeId);if(!head?.choices.some(c=>c.id===draft.choiceId))throw Error('选项不属于当前节点。');}
  await db.storySessions.put(next);
 });
}
