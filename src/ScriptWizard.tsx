import {storyPerspectives,type StoryPerspective} from './scriptTypes';
import {WizardAssistanceUI} from './WizardAssistanceUI';
import {requestWizardAssistance} from './wizardAssistance';
import type {WizardAssistanceKind} from './wizardAssistanceTypes';
import {generateWizardOpening} from './wizardOpening';
import {WizardSetupStatus} from './WizardSetupStatus';
import {createWizardWorld,findWizardCreation} from './scriptWizardCreation';
import {storyLengths} from './storyTypes';
import {useEffect,useRef,useState} from 'react';
import {db,usePhone} from './store';
import {useSpaces} from './spaces';
import {copyWizardIdentity,emptyWizardIdentity,loadWizardDraft,newWizardDraft,validateWizardDraft,wizardDraftKey,wizardLimits,wizardPaces,wizardStepError,type ScriptWizardDraft} from './scriptWizardDraft';
import './scriptWizard.css';
import {readWizardDocument} from './wizardDocumentImport';
import {saveLongNarrative,readLongNarrative,synopsisPreview} from './wizardLongNarrative';
import {analyzeLongNarrative} from './wizardSourceAnalysis';
import {indexSimulatorDocument,simulatorEvidence} from './wizardSimulatorDocument';
const steps=['剧情设定','主控面具','关联角色','开局方向','生成与进入'];
export function ScriptWizard(){
 const s=usePhone(),nav=useSpaces(),key=wizardDraftKey(db.name);
 const [initial]=useState(()=>{try{return {...loadWizardDraft(localStorage,key),error:''};}catch{return {draft:newWizardDraft(),raw:undefined,error:'无法读取草稿，未覆盖原数据。请检查浏览器存储或主动丢弃损坏草稿。'};}});
 const [longSource,setLongSource]=useState<{name:string;characters:number;sections:number}|null>(null);
 const [sourceAnalysis,setSourceAnalysis]=useState('');
 const [simulatorSections,setSimulatorSections]=useState<ReturnType<typeof indexSimulatorDocument>>([]);
 const [sourceSearch,setSourceSearch]=useState('');
 const [analyzingSource,setAnalyzingSource]=useState(false);
 const [draft,setDraft]=useState(initial.draft),[error,setError]=useState(initial.error),[saved,setSaved]=useState(false),[reading,setReading]=useState(false),[creating,setCreating]=useState(false),[createdId,setCreatedId]=useState(initial.draft.createdWorldId),[recovering,setRecovering]=useState(true),[assisting,setAssisting]=useState(false),[openingError,setOpeningError]=useState('');
 const wizardRoot=useRef<HTMLElement>(null);
 const [visibleHeight,setVisibleHeight]=useState<number|null>(null);
 useEffect(()=>{const measure=()=>{const el=wizardRoot.current;if(!el)return;const vp=window.visualViewport;const bottom=(vp?.offsetTop??0)+(vp?.height??window.innerHeight);setVisibleHeight(Math.max(240,Math.floor(bottom-el.getBoundingClientRect().top)));};measure();window.visualViewport?.addEventListener('resize',measure);window.visualViewport?.addEventListener('scroll',measure);window.addEventListener('resize',measure);return()=>{window.visualViewport?.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};},[recovering,createdId]);
 const assistant=useRef<AbortController|null>(null);
 const creationLock=useRef(false);
 const stored=useRef(initial.raw),alive=useRef(true),request=useRef(0),content=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null);
 useEffect(()=>{alive.current=true;
  void (async()=>{try{if(!initial.draft.createdWorldId&&initial.draft.creationToken){const world=await findWizardCreation(initial.draft.creationToken);if(world&&alive.current)setCreatedId(world.id);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'无法复核创建状态。');}finally{if(alive.current)setRecovering(false);}})();
  const hide=()=>assistant.current?.abort();window.addEventListener('pagehide',hide);return()=>{alive.current=false;request.current++;assistant.current?.abort();window.removeEventListener('pagehide',hide);};},[]);
 useEffect(()=>{const id=draft.longSourceId;if(!id){setLongSource(null);setSimulatorSections([]);return;}let live=true;void readLongNarrative(id).then(source=>{if(live){setLongSource(source?{name:source.name,characters:source.body.length,sections:source.sections.length}:null);setSimulatorSections(source?indexSimulatorDocument(source.body):[]);}}).catch(()=>{if(live)setLongSource(null);});return()=>{live=false;};},[draft.longSourceId]);
 const available=new Set(s.characters.map(c=>c.id));
 function update(patch:Partial<ScriptWizardDraft>){
  const next={...draft,...patch,confirmed:patch.confirmed??false};setDraft(next);setSaved(false);setError('');
  try{validateWizardDraft(next);if(stored.current===undefined||localStorage.getItem(key)!==stored.current)throw Error('conflict');const raw=JSON.stringify(next);localStorage.setItem(key,raw);stored.current=raw;setSaved(true);return true;}
  catch{setError('草稿未保存：存储不可用、空间不足或另一页面已更新草稿。当前输入仍保留，请勿关闭页面；重新进入前请自行保留内容。');return false;}
 }
 async function assist(kind:WizardAssistanceKind){
  if(assistant.current||reading||creating)return;const controller=new AbortController();assistant.current=controller;setAssisting(true);setError('');
  try{const snapshot={...draft,creationToken:draft.creationToken??crypto.randomUUID()};if(!update({creationToken:snapshot.creationToken}))throw Error('无法可靠保存草稿标识，未请求模型。');const result=await requestWizardAssistance(kind,snapshot,controller.signal);if(alive.current&&!controller.signal.aborted)update({suggestions:{...draft.suggestions,[kind]:result},creationToken:snapshot.creationToken});}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'推荐未完成，原输入保留。');}
  finally{if(assistant.current===controller)assistant.current=null;if(alive.current)setAssisting(false);}
 }
 function go(step:number){if(step>draft.step){const message=wizardStepError(draft,draft.step,available);if(message){setError(message);return;}}update({step});content.current?.scrollTo({top:0});}
 async function importFile(selected?:File){
  if(!selected)return;const ticket=++request.current;setReading(true);setError('');
  try{if(selected.size>wizardLimits.fileBytes)throw Error('文件超过 2 MB，请缩小后重试。');const patch=await readWizardDocument(selected);
   if(!alive.current||ticket!==request.current)return;
   if((draft.title||draft.synopsis||draft.rules||draft.direction)&&!confirm('用文件内容替换对应草稿字段？不会修改任何现有世界。'))return;
   if(patch.longBody){const source=await saveLongNarrative(selected.name,patch.longBody);setLongSource({name:source.name,characters:source.body.length,sections:source.sections.length});setSimulatorSections(indexSimulatorDocument(source.body));setSourceAnalysis('');update({synopsis:synopsisPreview(source.body),longSourceId:source.id,longSourceName:source.name});}
   else update(patch);
  }catch(e){if(alive.current&&ticket===request.current)setError(e instanceof Error?e.message:'读取失败，原草稿未改变。');}
  finally{if(alive.current&&ticket===request.current)setReading(false);}
 }
 async function confirmDraft(){
  if(creationLock.current||reading||recovering)return;
  for(let i=0;i<4;i++){const message=wizardStepError(draft,i,available);if(message){setError(message);return;}}
  const input={...draft,creationToken:draft.creationToken??crypto.randomUUID()};
  try{validateWizardDraft(input);if(stored.current===undefined||localStorage.getItem(key)!==stored.current)throw Error('conflict');const raw=JSON.stringify(input);localStorage.setItem(key,raw);stored.current=raw;setDraft(input);}
  catch{setError('创建前无法可靠保存草稿标识，请检查存储权限或其他页面。未创建世界。');return;}
  creationLock.current=true;setCreating(true);setError('');
  try{const world=await createWizardWorld(input);if(!alive.current)return;
   setCreatedId(world.id);
   const receipt={...input,step:4,confirmed:true,createdWorldId:world.id};
   try{if(localStorage.getItem(key)===stored.current){const raw=JSON.stringify(receipt);localStorage.setItem(key,raw);stored.current=raw;}}catch{/* The committed database token remains authoritative; never report a failed creation. */}
   void usePhone.getState().reload().catch(()=>{});
   if(document.visibilityState==='visible'){try{await generateWizardOpening(world.id,'confirmation');}catch(e){if(alive.current)setOpeningError(e instanceof Error?e.message:'开场生成未完成，配置已保存。');}}else setOpeningError('页面已进入后台，未自动请求模型；请返回后主动生成。');
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'创建失败，全部写入已回滚，草稿保留。');}
  finally{creationLock.current=false;if(alive.current)setCreating(false);}
 }
 const identityFields=[['name','姓名'],['gender','性别'],['appearance','外貌特征'],['personality','性格'],['occupation','身份与职业'],['experience','人物经历'],['bio','简介'],['customSetting','补充设定']] as const;
 if(createdId)return <WizardSetupStatus worldId={createdId} openingError={openingError} onNewDraft={()=>{try{const next=loadWizardDraft(localStorage,key);stored.current=next.raw;setDraft(next.draft);setCreatedId(undefined);setOpeningError('');setSaved(true);setError('');}catch{setError('新草稿读取失败。');}}}/>;
 if(recovering)return <p role="status">正在复核创作草稿与创建状态…</p>;
 return <section ref={wizardRoot} style={visibleHeight?{height:visibleHeight,maxHeight:visibleHeight}:undefined} className="script-wizard" aria-label="AI 剧本创建向导" aria-busy={reading||creating||assisting}>
  <header className="wizard-heading"><h1>{draft.title||'创建新剧本'}</h1><p>第 {draft.step+1} 步 / 5 · {steps[draft.step]}</p><ol aria-label="创建进度">{steps.map((name,i)=><li key={name} aria-current={i===draft.step?'step':undefined}><span>{i+1}</span><small>{name}</small></li>)}</ol></header>
  <div className="wizard-content" ref={content} inert={reading||creating||assisting}>
   <p className="wizard-note">创建前的草稿仅保存在当前浏览器，不包含在 ZIP 备份中；确认创建后，世界、身份和角色关联将写入数据库。仅主动点击推荐或确认开局时调用 AI。</p>
   {draft.step===0&&<div className="wizard-fields">
    <h2>剧情设定</h2>
    <label>故事标题<input aria-label="故事标题" maxLength={80} value={draft.title} onChange={e=>update({title:e.target.value})}/></label>
    <label>整体剧情梗概<textarea aria-label="整体剧情梗概" rows={7} maxLength={10000} value={draft.synopsis} onChange={e=>update({synopsis:e.target.value})}/></label>
    <label>世界背景与补充（可选）<textarea aria-label="世界背景" rows={4} maxLength={6000} value={draft.background??''} onChange={e=>update({background:e.target.value})}/></label>
    <button type="button" disabled={reading||creating||assisting} onClick={()=>file.current?.click()}>导入世界设定 / 模拟器规则 / 剧情文件（Word / TXT / MD / JSON）</button>
    <input hidden ref={file} type="file" accept=".docx,.txt,.md,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,application/json" aria-label="剧情文件" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';void importFile(selected);}}/>
    {reading&&<p role="status">正在读取本地文件…</p>}
    {longSource&&<p role="status" className="wizard-note">已保存长篇原文：{longSource.name}，{longSource.characters.toLocaleString()} 字符，识别 {longSource.sections} 个章节或片段。梗概框显示可编辑的前段预览；尚未进行 AI 重点提取，生成时不会自动读取全文。</p>}
    {longSource&&<section className="wizard-source-analysis" aria-label="模拟器设定原文索引">
     <h3>模拟器原文索引（不改写规则）</h3>
     <p className="wizard-note">这是按标题和关键词生成的初步分类，并非 AI 已完整理解。原文仍保存在本机；尚未接入世界运行引擎。</p>
     <p className="wizard-note">{simulatorSections.length} 个标题区块 · {simulatorSections.filter(x=>x.kind==='mechanics').length} 个机制候选 · {simulatorSections.filter(x=>x.kind==='characters').length} 个角色候选 · {simulatorSections.filter(x=>x.kind==='opening_gate').length} 个开局条件候选</p>
     <label>搜索原文规则（关键词）<input aria-label="搜索模拟器原文" value={sourceSearch} onChange={e=>setSourceSearch(e.target.value)} placeholder="例如：感染、角色卡、禁止、资源"/></label>
     {sourceSearch.trim()&&<div aria-live="polite">{simulatorEvidence(simulatorSections,[sourceSearch.trim()],8).map(hit=><article key={hit.sectionId}><h4>{hit.heading} · {hit.kind}</h4><p>{hit.excerpt}</p><small>原文字符位置 {hit.start}–{hit.end}</small></article>)}</div>}
    </section>}
    {longSource&&<div className="wizard-source-analysis"><button type="button" disabled={analyzingSource||reading||creating} onClick={()=>{if(!draft.longSourceId)return;const controller=new AbortController();setAnalyzingSource(true);setError('');void analyzeLongNarrative(draft.longSourceId,controller.signal).then(result=>setSourceAnalysis(result)).catch(e=>setError(e instanceof Error?e.message:'原文分析失败')).finally(()=>setAnalyzingSource(false));}}>{analyzingSource?'正在分析原文片段…':'AI 片段整理（非完整模拟器规则解析）'}</button>
    {sourceAnalysis&&<><label>分析草稿（可编辑，尚未应用）<textarea aria-label="原文分析草稿" rows={10} value={sourceAnalysis} onChange={e=>setSourceAnalysis(e.target.value)}/></label><button type="button" onClick={()=>{if(!confirm('用审核后的分析结果替换剧情梗概？原始长篇文件仍保留。'))return;update({synopsis:sourceAnalysis.slice(0,10000)});setSourceAnalysis('');}}>确认并填入剧情梗概</button></>}
    <p className="wizard-note">此旧功能仅对部分片段做摘要，不适合直接作为模拟器运行规则。请核对人物、时间线与开场建议；未确认前不会修改设定。</p></div>}
    <p className="wizard-note">DOCX/TXT/MD 支持最长 500000 字符，长篇原文另存于本机浏览器；梗概仅显示预览。JSON 使用 version:1、synopsis，可选 title、rules、direction；不会导入世界或世界书。</p>
    <label>自定义内容与补充规则<textarea aria-label="补充规则" maxLength={4000} value={draft.rules} onChange={e=>update({rules:e.target.value})}/></label>
    <label>叙事人称<select aria-label="叙事人称" value={draft.perspective??'second'} onChange={e=>update({perspective:e.target.value as StoryPerspective})}>{Object.entries(storyPerspectives).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>剧情节奏<select aria-label="剧情节奏" value={draft.pace} onChange={e=>update({pace:e.target.value as ScriptWizardDraft['pace']})}>{Object.entries(wizardPaces).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {draft.pace==='custom'&&<label>自定义节奏<textarea aria-label="自定义节奏" maxLength={1000} value={draft.customPace} onChange={e=>update({customPace:e.target.value})}/></label>}
    <label>发展方向（可选）<textarea aria-label="发展方向" maxLength={4000} value={draft.direction} onChange={e=>update({direction:e.target.value})}/></label>
    <label>剧情篇幅<select aria-label="向导剧情篇幅" value={draft.length??'standard'} onChange={e=>update({length:e.target.value as ScriptWizardDraft['length']})}>{Object.entries(storyLengths).map(([key,value])=><option key={key} value={key}>{value.label} · 约 {value.target} 字</option>)}</select></label>
    <WizardAssistanceUI kind="pacing" draft={draft} busy={assisting} onRequest={()=>void assist('pacing')} onChange={update} onError={setError}/>
   </div>}
   {draft.step===1&&<div className="wizard-fields"><h2>主控面具</h2>
    <label>资料来源<select aria-label="主控资料来源" value={draft.identitySource??''} onChange={e=>{const source=e.target.value,identity=s.theme.userIdentities?.[source];if(source&&!identity){setError('身份资料已不存在，请重新选择。');return;}update({identitySource:source||undefined,identity:identity?copyWizardIdentity(identity):emptyWizardIdentity()});}}>
     <option value="">新建自定义主控</option><option disabled value="recent-unavailable">沿用上次面具（当前未记录使用历史）</option>
     {Object.entries(s.theme.userIdentities??{}).filter(([id])=>id==='daily'||s.worlds.some(w=>`world:${w.id}`===id)).map(([id,identity])=><option key={id} value={id}>{identity.name} · {id==='daily'?'日常身份':s.worlds.find(w=>`world:${w.id}`===id)?.name}</option>)}
    </select></label><p className="wizard-note">现有身份按空间保存，尚无独立面具库。选择后仅复制静态资料到本草稿，不修改原资料或带入聊天与记忆。</p>
    {identityFields.map(([field,label])=><label key={field}>{label}{field==='name'||field==='gender'||field==='occupation'?<input aria-label={`主控${label}`} maxLength={field==='name'?80:4000} value={draft.identity[field]} onChange={e=>update({identity:{...draft.identity,[field]:e.target.value}})}/>:<textarea aria-label={`主控${label}`} maxLength={4000} value={draft.identity[field]} onChange={e=>update({identity:{...draft.identity,[field]:e.target.value}})}/>}</label>)}
    {draft.identity.age!==undefined&&<label>年龄<input aria-label="主控年龄" maxLength={80} value={draft.identity.age} onChange={e=>update({identity:{...draft.identity,age:e.target.value}})}/></label>}
   </div>}
   {draft.step===2&&<div className="wizard-fields"><h2>关联角色</h2><p className="wizard-note">首位所选角色为主要角色，可关联多位。只引用基础资料，不读取其他空间的聊天、关系状态或记忆。</p>
    {s.characters.length===0&&<p>暂无已有角色，可在下方新建角色草稿。</p>}
    {s.characters.map(c=><label className="wizard-character" key={c.id}><input type="checkbox" checked={draft.characterIds.includes(c.id)} onChange={e=>{if(e.target.checked&&draft.characterIds.length>=20){setError('最多关联 20 位已有角色。');return;}update({characterIds:e.target.checked?[...draft.characterIds,c.id]:draft.characterIds.filter(id=>id!==c.id)});}}/>{c.name}{draft.characterIds[0]===c.id?' · 主要角色':''}</label>)}
    {draft.characterIds.some(id=>!available.has(id))&&<button onClick={()=>update({characterIds:draft.characterIds.filter(id=>available.has(id))})}>移除已失效的角色引用</button>}
    {draft.customCharacters.map((c,i)=><fieldset key={i}><legend>自定义角色 {i+1}{!draft.characterIds.length&&i===0?' · 主要角色':''}</legend>
     <label>姓名<input aria-label={`角色${i+1}姓名`} maxLength={80} value={c.name} onChange={e=>update({customCharacters:draft.customCharacters.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/></label>
     <label>人设<textarea aria-label={`角色${i+1}人设`} maxLength={4000} value={c.persona} onChange={e=>update({customCharacters:draft.customCharacters.map((x,n)=>n===i?{...x,persona:e.target.value}:x)})}/></label>
     <label>说话方式<textarea aria-label={`角色${i+1}说话方式`} maxLength={4000} value={c.speakingStyle} onChange={e=>update({customCharacters:draft.customCharacters.map((x,n)=>n===i?{...x,speakingStyle:e.target.value}:x)})}/></label>
     <label>当前世界关系与设定<textarea aria-label={`角色${i+1}世界设定`} maxLength={4000} value={c.worldSetting??''} onChange={e=>update({customCharacters:draft.customCharacters.map((x,n)=>n===i?{...x,worldSetting:e.target.value}:x)})}/></label>
     <button onClick={()=>update({customCharacters:draft.customCharacters.filter((_,n)=>n!==i)})}>移除此角色草稿</button>
    </fieldset>)}
    <button disabled={draft.customCharacters.length>=10} onClick={()=>update({customCharacters:[...draft.customCharacters,{name:'',persona:'',speakingStyle:''}]})}>＋ 自定义角色</button>
    <p className="wizard-note">自定义角色将在确认时保存到基础角色库，并出现在日常角色列表；新世界的聊天仍独立隔离。</p>
    <WizardAssistanceUI kind="character" draft={draft} busy={assisting} onRequest={()=>void assist('character')} onChange={update} onError={setError}/>
   </div>}
   {draft.step===3&&<div className="wizard-fields"><h2>开局方向</h2>
    <label>开场场景<textarea aria-label="开场场景" rows={6} maxLength={6000} value={draft.opening} onChange={e=>update({opening:e.target.value})}/></label>
    <label>预设方向示例（非 AI）<select aria-label="开场示例" value="" onChange={e=>{if(e.target.value&&(!draft.opening||confirm('用示例替换当前开场草稿？')))update({opening:e.target.value});}}><option value="">选择示例填入，可继续修改</option>{['一次意外的初次相遇。','一封来历不明的邀请打破了平静。','重逢时，双方发现过去的问题仍未解决。'].map(text=><option key={text} value={text}>{text}</option>)}</select></label>
    <WizardAssistanceUI kind="opening" draft={draft} busy={assisting} onRequest={()=>void assist('opening')} onChange={update} onError={setError}/>
    <p className="wizard-note">开局方案是创作设定，不是正式正文或已发生事实。确认开局将创建世界并付费生成一次正式开场。</p>
    <p className="wizard-note">较长梗概与背景会按请求预算选取原文片段，完整原文仍会保存；必要身份、规则与当前剧情无法完整纳入时，将在付费请求前停止并提示，不会自动重试。</p>
    <h3>开局前确认</h3><Summary draft={draft} names={draft.characterIds.map(id=>s.characters.find(c=>c.id===id)?.name??'角色已不可用')} roleSettings={draft.characterIds.map(id=>{const c=s.characters.find(x=>x.id===id);return c?[c.name,c.persona,c.speakingStyle].filter(Boolean).join('\n'):'角色已不可用';}).join('\n\n')}/>
   </div>}
   {draft.step===4&&<div className="wizard-fields"><h2>配置尚未创建世界</h2><p>这是第一批保留的确认草稿，请返回开局方向，确认后真实创建。不会自动调用 AI。</p><button onClick={()=>go(3)}>返回开局方向</button></div>}
  </div>
  <footer className="wizard-footer">{assisting&&<button onClick={()=>assistant.current?.abort()}>取消本次推荐</button>}{error&&<p role="alert">{error}</p>}<small role="status">{saved?'草稿已保存在当前浏览器':initial.raw?'已读取本地草稿':'尚未保存新草稿'}</small><div>
   <button disabled={draft.step===0||reading||creating||assisting} onClick={()=>go(draft.step-1)}>上一步</button>
   {draft.step<3&&<button className="primary" disabled={reading||creating||assisting} onClick={()=>go(draft.step+1)}>下一步</button>}
   {draft.step===3&&<button className="primary" disabled={reading||creating||assisting} onClick={()=>void confirmDraft()}>{creating?'正在创建…':'确认开局'}</button>}
   <button disabled={reading||creating||assisting} onClick={()=>{if(confirm('丢弃此浏览器中的创作草稿？现有世界和聊天不受影响。')){try{localStorage.removeItem(key);stored.current=null;setDraft(newWizardDraft());setSaved(false);setError('');}catch{setError('无法清除草稿，请检查存储权限。');}}}}>丢弃草稿</button>
  </div></footer>
 </section>;
}
function Summary({draft:d,names,roleSettings}:{draft:ScriptWizardDraft;names:string[];roleSettings:string}){return <dl className="wizard-summary"><dt>故事</dt><dd>{d.title||'未填写'}</dd><dt>梗概</dt><dd>{d.synopsis||'未填写'}</dd><dt>补充规则</dt><dd>{d.rules||'未填写'}</dd><dt>发展方向</dt><dd>{d.direction||'未填写'}</dd><dt>主控</dt><dd>{d.identity.name||'未填写'}</dd><dt>主控资料</dt><dd>{['gender','age','appearance','personality','occupation','experience','bio','customSetting'].map(k=>d.identity[k as keyof typeof d.identity]).filter(v=>v!==undefined&&v!=='').join('\n')||'未填写'}</dd><dt>关联角色</dt><dd>{[...names,...d.customCharacters.map(c=>c.name||'未命名')].join('、')||'未选择'}</dd><dt>角色设定</dt><dd>{[roleSettings,...d.customCharacters.map(c=>[c.name,c.persona,c.speakingStyle,c.worldSetting].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n')||'未填写'}</dd><dt>节奏</dt><dd>{wizardPaces[d.pace]}{d.pace==='custom'?` · ${d.customPace}`:''}</dd><dt>篇幅</dt><dd>{storyLengths[d.length??'standard'].label}</dd><dt>开场方向</dt><dd>{d.opening||'未填写'}</dd></dl>;}
