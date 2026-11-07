import {useEffect,useState,useSyncExternalStore} from 'react';
import {liveQuery} from 'dexie';
import {readWizardSetup} from './scriptWizardCreation';
import {db,usePhone} from './store';
import {useSpaces} from './spaces';
import {newWizardDraft,wizardDraftKey,wizardPaces} from './scriptWizardDraft';
import {storyLengths} from './storyTypes';
import {enterWizardStory,generateWizardOpening,openingIsActive,stopWizardOpening,subscribeWizardOpening} from './wizardOpening';
import './scriptWizard.css';
const errors={request:'API 请求失败，请检查当前默认配置和网络。',invalid:'模型未返回有效正文及四个选项。',stale:'世界配置或人物资料已变化，过期结果未保存。',cancelled:'生成已取消或中断。',budget:'完整设定超过当前安全输入预算。'};
/** Observes persisted state only. Reload/mount never starts a paid request. */
export function WizardSetupStatus({worldId,onNewDraft,openingError}:{worldId:string;openingError?:string;onNewDraft?:()=>void}){
 const nav=useSpaces(),[data,setData]=useState<Awaited<ReturnType<typeof readWizardSetup>>>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 useEffect(()=>{setData(undefined);setError('');const sub=liveQuery(()=>readWizardSetup(worldId)).subscribe({next:setData,error:e=>setError(e instanceof Error?e.message:'无法读取配置，原世界未改变。')});return()=>sub.unsubscribe();},[worldId]);
 const localActive=useSyncExternalStore(subscribeWizardOpening,()=>openingIsActive(worldId),()=>false);
 useEffect(()=>{if(openingError)setError(openingError);},[openingError]);
 const session=data?.session,pending=session?.pending,waiting=!!pending&&pending.expiresAt>clock,running=busy||waiting||localActive,ready=!!data?.started;
 useEffect(()=>{if(!pending)return;const timer=setTimeout(()=>setClock(Date.now()),Math.max(0,pending.expiresAt-Date.now()+20));return()=>clearTimeout(timer);},[pending?.token,pending?.expiresAt]);
 async function generate(){
  if(running||ready||!data)return;
  if(session&&!confirm('上次开场请求可能已经产生费用。重试会发起新的模型请求，是否确认？'))return;
  setBusy(true);setError('');try{await generateWizardOpening(worldId,session?'retry':'start');}catch(e){setError(e instanceof Error?e.message:'生成未完成，配置和已保存正文保留。');}finally{setBusy(false);setClock(Date.now());}
 }
 async function newDraft(){if(!confirm('开始另一份创作草稿？已创建的世界和主线不会删除。'))return;try{localStorage.setItem(wizardDraftKey(db.name),JSON.stringify(newWizardDraft()));if(onNewDraft)onNewDraft();else await nav.openWorldEditor('wizard');}catch{setError('无法保存新草稿，请检查浏览器存储权限。');}}
 const status=ready?'生成成功，正文和 A/B/C/D 已保存。':waiting&&!localActive&&!busy?'已有生成请求记录，等待结果或租约到期。本页无法确认刷新前或其他窗口的请求是否仍在运行，不会重复请求。':running?'正在生成正式开场…':session?`生成失败或请求状态待确认。${session.error?errors[session.error]:'上次请求租约已过期，无法确认服务端是否计费。'}不会自动重试。`:'准备生成。世界和开局配置已保存；此页面不会自动调用模型。';
 return <section className="script-wizard" aria-label="已创建剧本配置"><header className="wizard-heading"><h1>{data?.world.name??'剧本配置'}</h1><p>第 5 步 / 5 · 正式开场</p></header><div className="wizard-content">
  {!data&&!error&&<p role="status">正在读取已保存的配置…</p>}{error&&<p role="alert">{error}</p>}
  {data&&<><p role="status">{status}</p>
   {!ready&&<p className="wizard-note">使用当前默认 API，产生 Token 费用。篇幅是目标，实际受模型和输出上限限制；不会为凑字数自动重试。</p>}
   <dl className="wizard-summary"><dt>故事梗概</dt><dd>{data.world.description}</dd><dt>补充设定</dt><dd>{data.world.rules||'未填写'}</dd><dt>主控</dt><dd>{data.identity?.name??'身份资料已被移除，请在世界设置中检查。'}</dd>{data.identity&&<><dt>主控设定</dt><dd>{['gender','age','appearance','personality','occupation','experience','bio','customSetting'].map(k=>data.identity?.[k]).filter(v=>typeof v==='string'||typeof v==='number').join('\n')||'未填写'}</dd></>}<dt>关联角色</dt><dd>{data.characters.map((c,i)=>`${data.profiles[i]?.scriptOrder===0?'主要角色 · ':''}${c.name}`).join('、')||'角色已解除关联，请在角色管理中检查。'}</dd><dt>节奏</dt><dd>{wizardPaces[data.world.script?.pace??'balanced']}{data.world.script?.customPace?` · ${data.world.script.customPace}`:''}</dd><dt>篇幅</dt><dd>{storyLengths[data.world.storyPreferences?.length??'standard'].label}</dd><dt>开场方向</dt><dd>{data.world.script?.opening}</dd><dt>发展方向</dt><dd>{data.world.script?.direction||'未填写'}</dd></dl>
  </>}
 </div><footer className="wizard-footer"><div>
  {ready?<button className="primary" onClick={()=>void enterWizardStory(worldId).catch(e=>setError(e.message))}>进入故事</button>:data&&<button className="primary" disabled={running||data.world.script?.playMode!=='story'} onClick={()=>void generate()}>{waiting&&!localActive&&!busy?'等待已有请求…':running?'正在生成…':session?'重试生成开场':'生成开场'}</button>}
  {localActive&&!ready&&<button onClick={()=>stopWizardOpening(worldId)}>取消本次生成</button>}
  <button onClick={()=>void usePhone.getState().reload().then(()=>nav.manageWorlds()).catch(()=>setError('无法刷新列表，已保存的世界未改变。'))}>返回剧本世界列表</button><button disabled={running} onClick={()=>void newDraft()}>开始另一份草稿</button>
 </div></footer></section>;
}
