import {createDocumentSnapshot} from './wizardDocumentSnapshot';
import {compileSimulatorRuntime} from './wizardSimulatorRuntime';
import {synopsisPreview} from './wizardLongNarrative';
import type {DocumentRuntimeConfig} from './wizardRuntimeConfig';
import {readStory} from './storyStore';
import {readLongNarrative} from './wizardLongNarrative';
import {db,type World,type Character} from './store';
import {copyWizardIdentity,validateWizardDraft,wizardStepError,type ScriptWizardDraft} from './scriptWizardDraft';
import {validateScriptConfig} from './scriptValidation';
import {validateStoryPreferences} from './storyValidation';
const tables=()=>[db.worlds,db.characters,db.worldProfiles,db.themes,db.assets];
/** Read-only recovery does not depend on the browser draft or create a StorySession. */
export async function readWizardSetup(worldId:string){
 return db.transaction('r',[...tables(),db.storySessions,db.storyNodes],async()=>{
  const world=await db.worlds.get(worldId);if(!world?.script?.creation)throw Error('已创建的剧本不存在或不来自向导；未重新创建。');validateScriptConfig(world.script);if(world.storyPreferences)validateStoryPreferences(world.storyPreferences);
  const identity=(await db.themes.get('global'))?.userIdentities?.[`world:${world.id}`];
  const profiles=(await db.worldProfiles.where('worldId').equals(world.id).toArray()).sort((a,b)=>(a.scriptOrder??999)-(b.scriptOrder??999)||a.id.localeCompare(b.id));
  const characters:Character[]=[];for(const p of profiles){const character=await db.characters.get(p.characterId);if(!character)throw Error('角色关联失效，请先检查角色管理。');characters.push(character);}
  const story=await readStory(worldId);return {world,identity,characters,profiles,session:story.session,started:story.path.length>0};
 });
}
export async function findWizardCreation(token:string){
 const worlds=await db.worlds.filter(w=>w.script?.creation?.token===token).toArray();
 if(worlds.length>1)throw Error('存在多份同源导入剧本，请从剧本列表明确选择，未重复创建。');return worlds[0];
}
/** One transaction creates every entity; the stable token also deduplicates tabs/reloads.
 * No requests, conversations, branches, memories, StorySessions or nodes are created. */
export async function createWizardWorld(input:Readonly<ScriptWizardDraft>):Promise<World>{
 const d=structuredClone(input);validateWizardDraft(d);
 if(!d.creationToken)throw Error('请先保存草稿创建标识，再确认创建。');
 const source=d.longSourceId?await readLongNarrative(d.longSourceId):undefined;
 if(source&&!source.preparation){const {listSimulatorReviews}=await import('./wizardSimulatorReviewStore');if(!(await listSimulatorReviews(source.id,source.body.length)).length)throw Error('剧本尚未准备完成，请返回第一步点击重新准备。');}
 if(d.longSourceId&&!source)throw Error('原始模拟器文档不存在，未创建不完整世界。');
 let runtime:DocumentRuntimeConfig|undefined;if(d.documentMode==='simulation'&&!source?.preparation){try{runtime=JSON.parse(d.runtimeConfig??'');}catch{throw Error('请填写有效的模拟状态 JSON，未创建世界。');}}
 const document=source?await createDocumentSnapshot(source.id,d.documentMode??'narrative',runtime):undefined;
 const policy=document?await compileSimulatorRuntime(document.source.id,document):undefined;
 const publicSummary:string[]=[];let summaryLength=0;for(const rule of policy?.publicRules??[]){if(summaryLength+rule.text.length+1>10000)break;publicSummary.push(rule.text);summaryLength+=rule.text.length+1;}
 const synopsis=source&&d.synopsis===synopsisPreview(source.body)?(publicSummary.join('\n')||'导入资料已审核；使用确认的公开资料创作。'):d.synopsis;
 const snapshot={...(document?{documentRevision:document.revision}:{}),...(d.longSourceId?{longSourceId:d.longSourceId,longSourceName:source!.name,longSourceCharacters:source!.body.length}:{}),...(d.perspective&&d.perspective!=='second'?{perspective:d.perspective}:{}),...(d.background?{background:d.background}:{}),title:d.title.trim(),synopsis:d.synopsis,rules:d.rules,direction:d.direction,pace:d.pace,customPace:d.pace==='custom'?d.customPace:'',identity:copyWizardIdentity({...d.identity}),characterIds:d.characterIds,customCharacters:d.customCharacters.map(c=>({...c,name:c.name.trim()})),opening:d.opening,length:d.length??'standard'};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))),fingerprint=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 return db.transaction('rw',tables(),async()=>{
  const existing=await findWizardCreation(d.creationToken!);
  if(existing){if(existing.script!.creation!.fingerprint!==fingerprint)throw Error('此草稿已创建过世界；配置变化未覆盖原世界，请从列表继续或新建草稿。');return existing;}
  if(d.createdWorldId)throw Error('原世界已被删除，未从过期草稿恢复或重新创建。');
  const selected:Character[]=[];for(const id of d.characterIds){const c=await db.characters.get(id);if(!c)throw Error('已选角色已被删除，未创建世界。');selected.push(c);}
  for(let step=0;step<4;step++){const error=wizardStepError(d,step,new Set(selected.map(c=>c.id)));if(error)throw Error(error);}
  const theme=await db.themes.get('global');if(!theme)throw Error('无法读取身份配置，未创建世界。');
  if(snapshot.identity.avatar&&!await db.assets.get(snapshot.identity.avatar))throw Error('主控头像资源已失效，请重新选择身份或移除该引用。');
  const id=`wizard-${d.creationToken}`,world:World={id,name:snapshot.title,description:synopsis,rules:d.rules,background:d.background??'',...(document?{storyDocument:document}:{}),...(source&&document?.mode==='simulation'?{simulatorSource:{id:source.id,name:source.name,characters:source.body.length}}:{}),createdAt:Date.now(),script:{version:1,playMode:'story',perspective:d.perspective??'second',opening:d.opening,direction:d.direction,definitionRevision:1,pace:d.pace,...(d.pace==='custom'?{customPace:d.customPace}:{}),creation:{version:1,token:d.creationToken!,fingerprint}},storyPreferences:{length:d.length??'standard'}};
  validateScriptConfig(world.script);validateStoryPreferences(world.storyPreferences);
  await db.worlds.add(world);
  const newCharacters:Character[]=d.customCharacters.map((c,i)=>({id:`wizard-character-${d.creationToken}-${i}`,name:c.name.trim(),persona:c.persona,speakingStyle:c.speakingStyle}));
  if(newCharacters.length)await db.characters.bulkAdd(newCharacters);
  for(const [order,c] of [...selected,...newCharacters].entries())await db.worldProfiles.add({id:`wizard-profile-${d.creationToken}-${order}`,worldId:id,characterId:c.id,setting:order<selected.length?'':d.customCharacters[order-selected.length].worldSetting??'',scriptOrder:order});
  const identity={...snapshot.identity,name:snapshot.identity.name.trim(),updatedAt:Date.now()};
  await db.themes.update('global',{userIdentities:{...theme.userIdentities,[`world:${id}`]:identity}});
  return world;
 });
}
