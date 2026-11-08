import {generateStory} from './storyGeneration';
import {readStory} from './storyStore';
import {usePhone} from './store';
import {useSpaces} from './spaces';
import {storyFailureFromError,type StoryFailure} from './storyFailure';
const active=new Map<string,AbortController>(),listeners=new Set<()=>void>();
const failures=new Map<string,StoryFailure>();
export const getWizardOpeningFailure=(worldId:string)=>failures.get(worldId);
export function subscribeWizardOpening(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
const notify=()=>listeners.forEach(listener=>listener());
export function openingIsActive(worldId:string){return active.has(worldId);}
export function stopWizardOpening(worldId:string){active.get(worldId)?.abort();}
/** Called only from a user confirmation/start/retry handler, never from mount effects.
 * StorySession's atomic first-attempt admission also protects different browser tabs. */
export async function generateWizardOpening(worldId:string,intent:'confirmation'|'start'|'retry'){
 if(active.has(worldId))throw Error('本页面已有开场生成任务，请勿重复请求。');
 const controller=new AbortController();active.set(worldId,controller);failures.delete(worldId);notify();const hide=()=>controller.abort();window.addEventListener('pagehide',hide);
 try{
  const data=await readStory(worldId);if(!data.world.script?.creation||data.world.script.playMode!=='story')throw Error('此入口仅用于向导创建的剧情世界。');
  if(data.path.length)return data.path.at(-1)!;
  const s=data.session;
  if(intent!=='retry'&&s)throw Error('已有开场生成记录，请核对状态后主动重试；未自动发起请求。');
  if(s?.pending&&s.pending.expiresAt>Date.now())throw Error('该世界已有生成请求，正在等待结果；请勿重复计费。');
  return await generateStory(worldId,undefined,{signal:controller.signal,firstAttemptOnly:intent!=='retry',expected:{sessionId:s?.id,headNodeId:s?.headNodeId,revision:s?.revision??0}});
 }catch(error){const diagnostic=storyFailureFromError(error);if(diagnostic){failures.set(worldId,diagnostic);while(failures.size>20)failures.delete(failures.keys().next().value!);}throw error;}
 finally{window.removeEventListener('pagehide',hide);if(active.get(worldId)===controller)active.delete(worldId);notify();}
}
export async function enterWizardStory(worldId:string){
 const data=await readStory(worldId);if(!data.path.length)throw Error('尚无已保存正文，未打开空白阅读器。');
 await usePhone.getState().reload();await useSpaces.getState().enterSpace(`world:${worldId}`);
 const nav=useSpaces.getState();if(nav.space?.worldId!==worldId||nav.transitioning)throw Error('进入故事失败，已保存正文不会重新生成，请从列表重试。');
 usePhone.getState().set({activeApp:'剧本'});
}
export async function continueWizardStory(worldId:string){const data=await readStory(worldId);if(data.path.length)await enterWizardStory(worldId);else await useSpaces.getState().openWorldEditor('setup',worldId);}
