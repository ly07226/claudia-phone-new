import {replayDocumentState} from './wizardRuntimeConfig';
import {readStoryParticipants} from './storyParticipants';
import {normalizeStoryAction} from './storyActions';
import {storyInput} from './storyContext';
import {replaySimulatorState} from './wizardSimulatorState';
import {db,type World} from './store';
import {validateScriptConfig} from './scriptValidation';
import {validateStoryNode,validateStorySession,validateStoryPreferences,validateStoryGuidance} from './storyValidation';
import {storyLimits,type StoryDefinition,type StoryNode,type StorySession,type StoryAction,type StoryDraft,type StoryLength,type StoryExpectedProgress,type StoryGuidance} from './storyTypes';
export function storyDefinition(w:World):StoryDefinition {
 validateScriptConfig(w.script);if(w.script.playMode!=='story')throw Error('此世界未开启剧情模式。');
 return {...(w.storyDocument?{documentRevision:w.storyDocument.revision}:{}),name:w.name,description:w.description,rules:w.rules??'',background:w.background??'',script:structuredClone(w.script)};
}
export async function resolveStoryDefinition(w:World):Promise<StoryDefinition>{const definition=storyDefinition(w),participants=await readStoryParticipants(w);return participants?{...definition,participants}:definition;}
export const storyTables=()=>[db.worlds,db.storySessions,db.storyNodes,db.themes,db.characters,db.worldProfiles];
export async function readStoryPath(s:StorySession){
 const path:StoryNode[]=[],seen=new Set<string>();let id=s.headNodeId;
 while(id){if(seen.has(id))throw Error('主线路径循环。');seen.add(id);const n=await db.storyNodes.get(id);if(!n||n.worldId!==s.worldId||n.sessionId!==s.id||n.sequence!==s.revision-path.length)throw Error('主线路径无效。');validateStoryNode(n);path.push(n);id=n.parentNodeId;}
 if(path.length!==s.revision)throw Error('主线路径断链。');const ordered=path.reverse();const world=await db.worlds.get(s.worldId);if(world?.storyDocument?.runtime)replayDocumentState(ordered,world.storyDocument.runtime);else replaySimulatorState(ordered);return ordered;
}
export interface StoryReadResult {world:World;session?:StorySession;path:StoryNode[]}
/** A view may reuse an immutable path when only its draft/settings changed.
 * Mutation/generation and default callers still resolve and validate the full path. */
export async function readStory(worldId:string,previous?:StoryReadResult):Promise<StoryReadResult>{return db.transaction('r',storyTables(),async()=>{
 const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');const session=await db.storySessions.where('worldId').equals(worldId).first();if(session)validateStorySession(session);
 const same=session&&previous?.world.storyDocument?.revision===world.storyDocument?.revision&&previous?.world.id===worldId&&previous.session?.id===session.id&&previous.session.headNodeId===session.headNodeId&&previous.session.revision===session.revision;
 return {world,session,path:session?same?previous!.path:await readStoryPath(session):[]};
});}
export async function claimStory(worldId:string,actionInput:string|StoryAction|undefined,allowOldDefinition:boolean,expected?:StoryExpectedProgress,firstAttemptOnly=false,operation:'advance'|'regenerate'='advance',reservedBytes=0){
 if(!['advance','regenerate'].includes(operation))throw Error('主线操作无效，未修改进度。');
 return db.transaction('rw',storyTables(),async()=>{
  const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');const currentDefinition=await resolveStoryDefinition(world);
  let s=await db.storySessions.where('worldId').equals(worldId).first();
  if(s&&s.definition.documentRevision!==currentDefinition.documentRevision)throw Error('文档归档版本已变化，未使用旧主线推进新设定。');
  if(firstAttemptOnly&&s)throw Error('开场已有生成记录，不会自动重复调用；请检查状态并主动决定是否重试。');
  if(s?.pending&&s.pending.expiresAt>Date.now())throw Error('本世界主线正在生成，请勿重复请求。');
  if(s)validateStorySession(s);
  if(expected&&(expected.sessionId!==s?.id||expected.headNodeId!==s?.headNodeId||expected.revision!==(s?.revision??0)))throw Error('主线已在其他页面推进，请刷新并重新确认行动；未请求模型。');
  // No immutable nodes exist yet: an explicit wizard retry uses the current saved setup.
  if(s&&s.revision===0&&world.script?.creation)s={...s,definition:currentDefinition,definitionRevision:world.script.definitionRevision};
  if(s&&s.definitionRevision!==world.script!.definitionRevision&&!allowOldDefinition)throw Error('设定已变化，请确认继续使用主线开始时的设定。');
  let path=s?await readStoryPath(s):[];const replacement=operation==='regenerate'?path.at(-1):undefined;
  if(operation==='regenerate'){if(!replacement||actionInput!==undefined)throw Error('没有可重新生成的已完成回合。');if(await db.storyNodes.where('parentNodeId').equals(replacement.id).count())throw Error('末节点存在后续引用，请先检查主线状态。');path=path.slice(0,-1);}
  const head=path.at(-1),action=normalizeStoryAction(replacement?(replacement.action??replacement.fromChoiceId):actionInput);
  const choiceId=action?.kind==='choice'?action.choiceId:undefined;
  if(head?!action||(action.kind==='choice'&&!head.choices.some(c=>c.id===action.choiceId)):action!==undefined)throw Error('选择已失效，请重新读取当前剧情。');
  if(operation==='advance'&&(s?.revision??0)>=storyLimits.nodes)throw Error('主线已达到安全容量上限，未删除旧节点。');
  const now=Date.now();s??={id:crypto.randomUUID(),worldId,revision:0,status:'idle',definitionRevision:world.script!.definitionRevision,definition:currentDefinition,createdAt:now,updatedAt:now};
  s={...s,status:'generating',error:undefined,failureDetails:undefined,updatedAt:now,pending:{token:crypto.randomUUID(),headNodeId:s.headNodeId,revision:s.revision,expiresAt:now+storyLimits.leaseMs}};
  if(operation==='advance'&&action&&head)s.actionDraft=action.kind==='custom'?{headNodeId:head.id,mode:'custom',customText:action.text}:{headNodeId:head.id,mode:'choice',customText:'',choiceId:action.choiceId};
  const length=world.storyPreferences?.length??'standard';if(world.storyPreferences)validateStoryPreferences(world.storyPreferences);
  const guidance=world.storyPreferences?.guidance;if(guidance?.enabled&&guidance.mode==='once'&&guidance.revision===Number.MAX_SAFE_INTEGER)throw Error('指导版本已达上限，未请求模型。');
  let input:string;try{input=storyInput(s,path,action,length,guidance?.enabled?guidance:undefined,storyLimits.inputBytes-reservedBytes,world.storyDocument?.referenceOnly?world.storyDocument.source.body:undefined);}catch{throw Error('必要身份、规则、开场、剧情指导或当前剧情仍超过当前安全输入预算，无法完整纳入。本次未请求模型、未推进主线，全部原文保留；不会自动重试。');}
  await db.storySessions.put(s);return {session:s,path,input,action,length,replacement,parentNodeId:head?.id,nextRevision:path.length+1,guidance,guidanceSnapshot:JSON.stringify(guidance??null),choice:head?.choices.find(c=>c.id===choiceId),documentSnapshot:JSON.stringify(world.storyDocument??world.simulatorSource??null),worldSnapshot:JSON.stringify(currentDefinition)};
 });
}

export async function saveStoryLength(worldId:string,length:StoryLength){
 validateStoryPreferences({length});
 await db.transaction('rw',db.worlds,async()=>{const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');storyDefinition(world);await db.worlds.update(worldId,{storyPreferences:{...world.storyPreferences,length}});});
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

/** Settings only; never advances the session or creates a generation lease. */
export async function saveStoryGuidance(worldId:string,input:Omit<StoryGuidance,'revision'>,expectedRevision:number){
 return db.transaction('rw',db.worlds,db.storySessions,async()=>{
  const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在，未保存指导。');storyDefinition(world);
  const session=await db.storySessions.where('worldId').equals(worldId).first();
  if(session?.pending&&session.pending.expiresAt>Date.now())throw Error('生成中不能修改指导，请等待完成。');
  const previous=world.storyPreferences?.guidance;if((previous?.revision??0)!==expectedRevision)throw Error('指导已在其他页面更新，请关闭后重新打开编辑。');
  const guidance={...input,revision:expectedRevision+1};validateStoryGuidance(guidance);
  const preferences={...world.storyPreferences,length:world.storyPreferences?.length??'standard',guidance};validateStoryPreferences(preferences);
  await db.worlds.update(worldId,{storyPreferences:preferences});return guidance;
 });
}

/** Remove only the current completed leaf. Expected progress and the active lease
 * protect other tabs; clearing an expired lease invalidates its delayed response. */
export async function withdrawStory(worldId:string,expected:StoryExpectedProgress){
 return db.transaction('rw',storyTables(),async()=>{
  const world=await db.worlds.get(worldId);if(!world)throw Error('世界已不存在。');storyDefinition(world);
  const s=await db.storySessions.where('worldId').equals(worldId).first();
  if(!s||s.id!==expected.sessionId||s.headNodeId!==expected.headNodeId||s.revision!==expected.revision)throw Error('主线已变化，请刷新后再撤回。');
  validateStorySession(s);if(s.pending&&s.pending.expiresAt>Date.now())throw Error('正在生成，不能撤回当前回合。');
  const path=await readStoryPath(s),head=path.at(-1),parent=path.at(-2);if(!head||!parent)throw Error('首回合没有上一轮可撤回，未清空开场。');
  if(await db.storyNodes.where('parentNodeId').equals(head.id).count())throw Error('末节点存在后续引用，未删除任何剧情。');
  const action=normalizeStoryAction(head.action??head.fromChoiceId);
  const draft:StoryDraft|undefined=action?.kind==='custom'?{headNodeId:parent.id,mode:'custom',customText:action.text}:action?.kind==='choice'?{headNodeId:parent.id,mode:'choice',customText:'',choiceId:action.choiceId}:undefined;
  if(draft?.choiceId&&!parent.choices.some(c=>c.id===draft.choiceId))throw Error('原行动与上一回合不匹配，未撤回。');
  const next:StorySession={...s,headNodeId:parent.id,revision:s.revision-1,interruptedOutput:undefined,status:'ready',pending:undefined,error:undefined,failureDetails:undefined,actionDraft:draft,updatedAt:Date.now()};validateStorySession(next);
  await db.storyNodes.delete(head.id);await db.storySessions.put(next);return next;
 });
}
