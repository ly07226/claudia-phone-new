import {storyGenerationNotice} from './storyDirectives';
import {StorySettingsPage} from './StorySettingsPage';
import {useStoryReading} from './useStoryReading';
import {ReplyFailureNotice} from './ReplyStatus';
import {describeReplyFailure,type ReplyFailureDetails} from './replyFailure';
import {StoryControls} from './StoryControls';
import {isLegacyDirectiveFailure,StoryGenerationError,storyFailureFromError,type StoryFailure} from './storyFailure';
import {StoryFailureDetails} from './StoryFailureDetails';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {liveQuery} from 'dexie';
import {usePhone} from './store';
import {readStory,saveStoryDraft,saveStoryLength,saveStoryGuidance,withdrawStory} from './storyStore';
import {generateStory} from './storyGeneration';
import {storyLimits,type StoryDraft,type StoryLength} from './storyTypes';
import {StoryReader} from './StoryReader';
import {useStoryViewport} from './useStoryViewport';
import './storyApp.css';
export function StoryApp({worldId}:{worldId:string}){
 const [data,setData]=useState<Awaited<ReturnType<typeof readStory>>>(),[error,setError]=useState(''),[selected,setSelected]=useState(''),[custom,setCustom]=useState(''),[mode,setMode]=useState<'choice'|'custom'>('choice'),[collapsed,setCollapsed]=useState(false),[running,setRunning]=useState(false),[refresh,setRefresh]=useState(0),[savingLength,setSavingLength]=useState(false);
 const [withdrawing,setWithdrawing]=useState(false),historyLock=useRef(false);
 const [generationFailure,setGenerationFailure]=useState<{message:string;details:ReplyFailureDetails;diagnostic?:StoryFailure}>();
 const [dialog,setDialog]=useState<'settings'|'guidance'|null>(null);
 const controller=useRef<AbortController|null>(null),alive=useRef(false),drafts=useRef(Promise.resolve()),hydrated=useRef('');
 const viewport=useStoryViewport();
 const reading=useStoryReading();
 const [settingsOpen,setSettingsOpen]=useState(false);
 function closeSettings(){setSettingsOpen(false);requestAnimationFrame(()=>viewport.ref.current?.querySelector<HTMLButtonElement>('[aria-label="剧本设置"]')?.focus({preventScroll:true}));}
 useEffect(()=>{alive.current=true;const hide=()=>controller.current?.abort();window.addEventListener('pagehide',hide);
  let previous:Awaited<ReturnType<typeof readStory>>|undefined;
  const sub=liveQuery(async()=>{const next=await readStory(worldId,previous);previous=next;return next;}).subscribe({next:d=>{if(alive.current)setData(d);},error:()=>{if(alive.current)setError('主线暂时无法读取，请重新打开；未重置进度。');}});
  return()=>{alive.current=false;controller.current?.abort();sub.unsubscribe();window.removeEventListener('pagehide',hide);};
 },[worldId,refresh]);
 const s=data?.session,node=data?.path.at(-1),generating=running||!!(s?.pending&&s.pending.expiresAt>Date.now()),busy=generating||withdrawing,length=data?.world.storyPreferences?.length??'standard';
 const changed=!!s&&s.definitionRevision!==data?.world.script?.definitionRevision;
 const pastFailure=describeReplyFailure(s?.failureDetails?new StoryGenerationError(s.failureDetails):undefined);
 const legacyStyleFailure=isLegacyDirectiveFailure(s?.failureDetails);
 const displayedFailure=generationFailure?generationFailure.diagnostic:!error&&!legacyStyleFailure?s?.failureDetails:undefined;
 if(!s?.failureDetails){if(s?.error==='invalid')pastFailure.reason='上次输出未通过校验，暂时无法确定具体失败原因。';
 else if(s?.error==='budget')pastFailure.reason='上次输入超过安全预算，未调用模型。';
 else if(s?.error==='stale')pastFailure.reason='设定或主线进度发生变化，旧响应未保存。';}
 const draftKey=s?`${s.id}:${s.headNodeId??''}`:'';
 useEffect(()=>{if(draftKey&&hydrated.current!==draftKey){hydrated.current=draftKey;const draft=s?.actionDraft;setSelected(draft?.choiceId??'');setCustom(draft?.customText??'');setMode(draft?.mode??'choice');}},[draftKey,s?.actionDraft]);
 function persist(draft:StoryDraft){
  drafts.current=drafts.current.then(()=>saveStoryDraft(worldId,draft)).catch(()=>{if(alive.current&&hydrated.current===draftKey)setError('行动草稿暂未保存，当前输入仍保留，请稍后重试。');});
 }
 function choose(id:string){if(!node)return;setSelected(id);setCustom('');setMode('choice');persist({headNodeId:node.id,mode:'choice',customText:'',choiceId:id});}
 function input(text:string){if(!node)return;setCustom(text);setSelected('');setMode('custom');persist({headNodeId:node.id,mode:'custom',customText:text});}
 async function changeLength(value:StoryLength){setSavingLength(true);try{await saveStoryLength(worldId,value);}catch{setError('篇幅设置未能保存，原设置保持不变。');throw Error('length');}finally{if(alive.current)setSavingLength(false);}}
 async function advance(operation:'advance'|'regenerate'='advance'){
  if(controller.current||historyLock.current||busy||!data||savingLength)return;
  if(changed&&!confirm(operation==='regenerate'?'世界设定已变化。本次仍按主线开始时的原设定重新生成当前回合，成功前保留原剧情。是否确认？':'世界设定已变化。已有主线不会重写，本次仍按主线开始时的原设定继续。是否确认？'))return;
  const c=controller.current=new AbortController();setRunning(true);setError('');setGenerationFailure(undefined);
  try{await drafts.current;await generateStory(worldId,operation==='regenerate'?undefined:node?(mode==='custom'?{kind:'custom',text:custom}:selected):undefined,{operation,signal:c.signal,allowOldDefinition:changed,expected:{sessionId:s?.id,headNodeId:s?.headNodeId,revision:s?.revision??0}});if(alive.current){setSelected('');setCustom('');setMode('choice');}}
  catch(e){if(alive.current){setError(e instanceof Error?e.message:'生成未完成，原进度保留。');if(!c.signal.aborted)setGenerationFailure({message:e instanceof Error?e.message:'生成未完成，原进度保留。',details:describeReplyFailure(e),diagnostic:storyFailureFromError(e)});}}
  finally{if(controller.current===c)controller.current=null;if(alive.current)setRunning(false);}
 }
 async function withdraw(){
  if(controller.current||historyLock.current||busy||!s||!node||savingLength)return;
  historyLock.current=true;setWithdrawing(true);setError('');setGenerationFailure(undefined);
  try{await drafts.current;await withdrawStory(worldId,{sessionId:s.id,headNodeId:s.headNodeId,revision:s.revision});}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'撤回未完成，原剧情保留。');}
  finally{historyLock.current=false;if(alive.current)setWithdrawing(false);}
 }
 const valid=!node||(mode==='custom'?!!custom.trim()&&custom.length<=storyLimits.action:node.choices.some(c=>c.id===selected));
 const style={height:viewport.height??'100%','--story-available-height':`${viewport.height??700}px`,'--story-drawer-height':`${Math.max(80,(viewport.height??700)*.6-44)}px`} as CSSProperties;
 return <article ref={viewport.ref} style={style} data-settings={settingsOpen} className={`story-app${(viewport.height??700)<440?' story-compact':''}`} aria-label="剧本主线">
  <header className="story-heading" inert={!!dialog||settingsOpen}><button aria-label="返回手机桌面" onClick={()=>usePhone.getState().set({activeApp:null})}>‹ 返回</button><div><h1>{data?.world.name??'剧本'}</h1><p>主线剧情 · {s?.revision??0} 段</p></div><button aria-label="剧本设置" disabled={!data} onClick={()=>setSettingsOpen(true)}>设置</button></header>
  {!data&&!error&&<p className="story-notice" role="status">正在读取主线…</p>}
  {!busy&&error&&(!generationFailure||generationFailure.message!==error)&&<p className="story-notice" role="alert">{error}</p>}
  {!busy&&generationFailure&&generationFailure.message===error&&<ReplyFailureNotice className="story-reply-failure" details={generationFailure.details}/>}
  {!busy&&s?.status==='failed'&&!error&&!generationFailure&&(legacyStyleFailure?<p className="story-notice" role="status">上次为旧版风格校验记录；当前不再阻断，可主动继续生成。</p>:s.error==='cancelled'&&!s.failureDetails?<p className="story-notice" role="status">上次生成已中断，原进度保留；不会自动重试。</p>:<ReplyFailureNotice className="story-reply-failure" details={pastFailure}/>)}
  {!busy&&displayedFailure&&<StoryFailureDetails failure={displayedFailure}/>}
  {changed&&<p className="story-notice">设定已更新；主线仍使用开始时的版本 {s?.definitionRevision}，继续前需要确认。</p>}
  {data?.world.script?.playMode!=='story'&&data?<p>此世界未开启剧情模式，已有主线数据保留。</p>:data&&<>
   <StoryReader writing={generating} key={worldId} inert={!!dialog||settingsOpen} path={data.path} opening={data.world.script!.opening} preferences={reading.preferences} onWithdraw={()=>void withdraw()} onRegenerate={()=>void advance('regenerate')} operationsBusy={busy||savingLength}/>
   <footer className="story-drawer" inert={!!dialog||settingsOpen} data-collapsed={collapsed}>
    <button className="story-drawer-handle" aria-expanded={!collapsed} aria-controls="story-operation-panel" aria-label={collapsed?'展开操作':'收起操作'} onClick={()=>setCollapsed(x=>!x)}><span className="story-drawer-caption">接下来，你想怎么做？</span><span className="story-drawer-chevron" aria-hidden="true">{collapsed?'⌃':'⌄'}</span></button>
    <div className="story-drawer-panel" id="story-operation-panel" inert={collapsed} aria-hidden={collapsed}>
     <div className="story-drawer-content">
      {node&&<fieldset className="story-options" disabled={busy}><legend>接下来，你想怎么做？</legend>{node.choices.map(c=><label key={c.id} className={mode==='choice'&&selected===c.id?'story-selected':''}><input type="radio" name="story-choice" value={c.id} checked={mode==='choice'&&selected===c.id} onChange={()=>choose(c.id)}/><strong>{c.label}</strong><span>{c.text}</span></label>)}</fieldset>}
     </div>
    </div>
     <div className="story-drawer-actions">
      <div className={`story-submit-row${node?' story-has-action':''}`}><button className="story-guide-button" aria-label="剧情指导" data-active={!!data.world.storyPreferences?.guidance?.enabled} disabled={busy} onClick={()=>setDialog('guidance')}>剧情指导</button>{node&&<textarea className="story-custom-input" aria-label="自定义行动" rows={1} maxLength={storyLimits.action} value={custom} disabled={busy} onChange={e=>input(e.target.value)} placeholder="或自己写下想做的事…"/>}<button className="primary story-submit" onPointerDown={e=>{if(document.activeElement?.matches('.story-custom-input'))e.preventDefault();}} disabled={busy||savingLength||!valid} onClick={()=>void advance()}>{generating?'正在生成…':withdrawing?'正在撤回…':node?'确认选择':'开始剧情'}</button></div>
      <p className="story-cost">调用当前默认 API 并计费，默认篇幅仅为目标。{storyGenerationNotice}</p>
     </div>
   </footer>
  </>}
  {settingsOpen&&data&&<StorySettingsPage preferences={reading.preferences} loaded={reading.loaded} saving={reading.saving} error={reading.error} onChange={reading.change} busy={busy} length={length} onLength={changeLength} onRefresh={()=>setRefresh(x=>x+1)} onBack={closeSettings}/>}
  {dialog&&data&&<StoryControls key={`${worldId}:${dialog}`} kind={dialog} guidance={data.world.storyPreferences?.guidance} length={length} busy={busy} availableHeight={viewport.height??700} onClose={()=>setDialog(null)} onSave={(value,revision)=>saveStoryGuidance(worldId,value,revision)} onLength={changeLength} onRefresh={()=>setRefresh(x=>x+1)}/>}
 </article>;
}
