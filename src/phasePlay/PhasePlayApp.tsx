import {useEffect,useRef,useState} from 'react';
import {db} from '../store';
import {baseInstructions} from './instructions';
import {bpmAt,beatsBetween,advance,defaults,initial,next,phases,phaseNames,start,type Phase,type PhaseData,type PhaseSettings,validData} from './engine';
import {loadPhaseData,savePhaseData,savePhaseSession} from './storage';
import {PhaseFeedback} from './feedback';
import {reconcileApiDefault} from '../apiSelection';
import {normalizedInstruction,replaceLibrary,scopePrompts,selectedScope} from './library';
import {generateLibrary} from './generation';
import './phasePlay.css';
export function PhasePlayApp({onBack}:{onBack:()=>void}){
 const [generating,setGenerating]=useState(false);
 const generationController=useRef<AbortController|null>(null);
 const [progress,setProgress]=useState('');
 const [showInstructionCards,setShowInstructionCards]=useState(false);
 const [worldOptions,setWorldOptions]=useState<{id:string;name:string}[]>([]);
 const [versions,setVersions]=useState<{savedAt:number;prompts:{id:string;phase:Phase|'all';text:string}[]}[]>([]);
 const [characters,setCharacters]=useState<{id:string;name:string}[]>([]);
 useEffect(()=>{let active=true;void db.characters.toArray().then(rows=>{if(active)setCharacters(rows.map(x=>({id:x.id,name:x.name})));});return()=>{active=false;};},[]);
 useEffect(()=>{let active=true;void db.worlds.toArray().then(rows=>{if(active)setWorldOptions(rows.map(w=>({id:w.id,name:w.name})));});return()=>{active=false;};},[]);
 const [screen,setScreen]=useState<'settings'|'running'>('settings'),[tab,setTab]=useState<'玩法'|'节奏'|'指令'|'其他'>('节奏');
 const [loaded]=useState(()=>loadPhaseData(db.name)),[data,setData]=useState(loaded.data),[error,setError]=useState(loaded.error),[blocked,setBlocked]=useState(!!loaded.error),[notice,setNotice]=useState(''),[editId,setEditId]=useState<string|null>(null),[text,setText]=useState(''),[scope,setScope]=useState<Phase|'all'>('all'),[pulse,setPulse]=useState(0);
 useEffect(()=>{const id=data?.settings?.instructionCharacterId;if(data.settings.instructionMode!=='character'){setVersions(data.libraryVersions?.default??[]);return;}if(!id){setVersions([]);return;}try{const rows=JSON.parse(localStorage.getItem('claudia.phasePlay.versions.v2:'+db.name+':'+encodeURIComponent(id)+':'+encodeURIComponent(data.settings.instructionWorldId??''))||'[]');setVersions(data.libraryVersions?.[selectedScope(data.settings)]??(Array.isArray(rows)?rows.filter(v=>v&&Number.isFinite(v.savedAt)&&Array.isArray(v.prompts)&&v.prompts.every((p:unknown)=>!!p&&typeof p==='object'&&'id' in p&&typeof p.id==='string'&&p.id.startsWith(selectedScope(data.settings))&&'text' in p&&typeof p.text==='string')):[]));}catch{setVersions([]);}},[data?.settings?.instructionMode,data?.settings?.instructionCharacterId,data?.settings?.instructionWorldId,data?.settings?.prompts,data.libraryVersions]);
 const current=useRef(data),feedback=useRef<PhaseFeedback|null>(null),last=useRef(performance.now()),saved=useRef(0);
 if(!feedback.current)feedback.current=new PhaseFeedback();
 function persist(value:PhaseData){try{savePhaseData(db.name,value);return true;}catch(e){setError((e as Error).message);return false;}}
 function change(value:PhaseData,save=true){if(blocked)return false;if(!validData(value)){setError('请输入有效设置：时长 1～600 秒，随机最短不超过最长。');return false;}if(save){setError('');if(!persist(value))return false;}current.current=value;setData(value);return true;}
 function pause(message=''){const d=current.current;if(d.session.status==='running'){const value={...d,session:{...d.session,status:'paused' as const}};current.current=value;setData(value);persist(value);}feedback.current?.stop();if(message)setNotice(message);}
 useEffect(()=>{
  const interval=window.setInterval(()=>{
   const now=performance.now(),elapsed=now-last.current;last.current=now;const d=current.current;
   if(d.session.status!=='running')return;
   if(document.hidden||elapsed>1500){pause('应用已暂停，请确认后继续。');return;}
   const value={...d,session:advance(d.settings,d.session,elapsed)};current.current=value;setData(value);
   if(value.session.status==='finished'){feedback.current?.stop();setNotice('本局时间已到，游戏结束。');persist(value);return;}
   if(d.settings.beat&&beatsBetween(d.settings,d.session.elapsedMs??0,value.session.elapsedMs??0)>0){setPulse(x=>x+1);feedback.current?.pulse(d.settings.sound,d.settings.volume,d.settings.vibration);}
   if(now-saved.current>=1000){saved.current=now;try{savePhaseSession(db.name,value);}catch{pause("进度保存失败，已暂停；原词库保留。");}}
  },100);
  const visibility=()=>{if(document.hidden){generationController.current?.abort();pause('离开前台后已暂停，返回时请主动继续。');}};
  const leave=()=>{generationController.current?.abort();pause();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leave);window.addEventListener('beforeunload',leave);
  return()=>{generationController.current?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);window.removeEventListener('beforeunload',leave);const d=current.current;if(d.session.status==='running'){const value={...d,session:{...d.session,status:'paused' as const}};try{savePhaseData(db.name,value);}catch{/* Do not touch any other storage on exit. */}}feedback.current?.dispose();};
 },[]);
 async function run(){if(blocked)return;const d=current.current;const value={...d,session:d.session.status==='idle'||d.session.status==='finished'?start(d.settings):{...d.session,status:'running' as const}};last.current=performance.now();if(!change(value))return;setNotice('');if(d.settings.sound&&!await feedback.current!.unlock())setNotice('此浏览器暂未启用音频，计时正常。可关闭音效后重新开启。');}
 function setting(patch:Partial<PhaseSettings>){generationController.current?.abort();const d=current.current,settings={...d.settings,...patch},reset=['duration','mode','randomDuration','gameMinutes','instructionMode','instructionCharacterId','instructionWorldId'].some(key=>key in patch);if(change({...d,settings,session:reset&&d.session.status==='paused'?initial(settings):d.session})&&reset&&d.session.status==='paused')setNotice('玩法或词库已改变，下次开始新一局。');}
 const s=data.settings,r=data.session,scopePrefix='character:'+encodeURIComponent(s.instructionCharacterId??'')+':'+encodeURIComponent(s.instructionWorldId??'')+':',seconds=Math.ceil(r.remainingMs/1000),gameSeconds=Math.ceil((r.gameRemainingMs??(s.gameMinutes??10)*60000)/1000),running=r.status==='running';
 const exit=()=>{generationController.current?.abort();pause();onBack();};
 const enter=async()=>{await run();if(current.current.session.status==='running')setScreen('running');};
 const backToSettings=()=>{pause();setScreen('settings');};
 async function generateCharacterLibrary(replace=false){
  const snapshot=current.current,id=snapshot.settings.instructionCharacterId;
  if(!id||generationController.current)return setError('请先选择角色，或等待当前生成完成。');
  const scope=selectedScope(snapshot.settings),previous=scopePrompts(snapshot.settings,scope);
  if(replace&&previous.length&&!confirm('重新生成将替换当前组合词库，并保留旧版本。继续吗？'))return;
  const controller=new AbortController();generationController.current=controller;setGenerating(true);setError('');
  try{
   const character=await db.characters.get(id);if(!character)throw Error('所选角色不存在。');
   const config=character.apiConfigId?await db.apiConfigs.get(character.apiConfigId):(await reconcileApiDefault()).config;
   if(!config?.enabled)throw Error('请先启用可用的 API 配置。');
   const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey)throw Error('当前 API 配置缺少密钥。');
   let worldContext='';if(snapshot.settings.instructionWorldId){const world=await db.worlds.get(snapshot.settings.instructionWorldId),profile=await db.worldProfiles.where('[worldId+characterId]').equals([snapshot.settings.instructionWorldId,id]).first();if(!world||!profile)throw Error('此角色未关联所选世界。');worldContext=JSON.stringify({name:world.name,background:world.background??'',rules:world.rules??'',setting:profile.setting});}
   const items=await generateLibrary({settings:snapshot.settings,character,worldContext,config,key:credential.apiKey,signal:controller.signal,existing:replace?[]:previous,onProgress:setProgress});
   if(controller.signal.aborted)throw Error('生成已取消，原词库保留。');
   if(current.current!==snapshot)throw Error('生成期间设置或词库已改变，本次结果未写入。');
   const updated=replaceLibrary(snapshot,scope,replace?items:[...previous,...items],versions);
   savePhaseData(db.name,updated);current.current=updated;setData(updated);setNotice('已保存30条指令，游戏时不再调用 API。');
  }catch(e){setError(e instanceof Error?e.message:'生成失败，原词库保留。');}
  finally{generationController.current=null;setGenerating(false);setProgress('');}
 }
 function makeCharacterDraft(){
  const id=s.instructionCharacterId;
  if(!id)return setError('请先选择角色。');
  const existing=s.prompts.filter(p=>p.id.startsWith(scopePrefix));
  if(existing.length&&!confirm('将重新建立此角色的基础指令草稿，覆盖此前编辑的角色指令。继续吗？'))return;
  const drafted=baseInstructions.map(item=>({id:scopePrefix+item.id,phase:item.phase,text:item.text}));
  if(drafted.length>1000)return setError('指令数量超出1000条限制。');
  const updated=replaceLibrary(current.current,scopePrefix,drafted,versions);
  try{savePhaseData(db.name,updated);current.current=updated;setData(updated);setError('');setNotice('已建立并保存基础指令草稿，尚未调用 AI。');}catch(e){setError(e instanceof Error?e.message:'草稿保存失败。');}
 }
 function savePrompt(){
  if(!text.trim())return setError('请输入提示文本。');
  if(s.instructionMode==='character'&&!s.instructionCharacterId)return setError('请先选择角色。');
  if(!editId&&scopePrompts(s).length>=1000)return setError('每个角色与世界组合最多保存1000条提示。');
  const item={id:editId??(s.instructionMode==='character'?scopePrefix+crypto.randomUUID():crypto.randomUUID()),phase:scope,text:text.trim()};
  const items=scopePrompts(s).filter(p=>p.id!==editId);if(items.some(p=>normalizedInstruction(p.text)===normalizedInstruction(item.text)))return setError('此组合已存在相同提示。');const updated=replaceLibrary(current.current,selectedScope(s),[...items,item],versions);
  try{savePhaseData(db.name,updated);current.current=updated;setData(updated);setError('');setEditId(null);setText('');setNotice('指令已保存。');}catch(e){setError(e instanceof Error?e.message:'保存失败，编辑内容仍保留。');}
 }
 return <section className="phase-play" aria-label="忍一下嘛应用" data-screen={screen}>
 <header className="phase-play-heading"><div><h2>忍一下嘛</h2><p>{screen==='settings'?'选择玩法与节奏，再开启一场游戏':'跟随灯光与指令，按自己的节奏来'}</p></div><button onClick={screen==='running'?backToSettings:exit}>{screen==='running'?'返回设置':'退出应用'}</button></header>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {blocked&&<button onClick={()=>{if(!confirm('只重置忍一下嘛的本地记录，其他数据不变。继续吗？'))return;const settings=defaults(),value:PhaseData={version:1,settings,session:initial(settings)};if(persist(value)){current.current=value;setData(value);setBlocked(false);setError('');}}}>重置本应用记录</button>}
 {screen==='settings'?<>
  <nav className="phase-play-tabs" aria-label="设置分类">{(['玩法','节奏','指令','其他'] as const).map(name=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}>{name}</button>)}</nav>
  <fieldset disabled={running||blocked} className="phase-play-settings">
  {tab==='玩法'&&<div className="phase-play-card"><h3>游戏方式</h3><label>整局时长<select aria-label="整局时长" value={s.gameMinutes??10} onChange={e=>{const gameMinutes=Number(e.target.value);const d=current.current,settings={...d.settings,gameMinutes};change({...d,settings,session:initial(settings)});}}>{[5,10,15,20,50].map(n=><option key={n} value={n}>{n} 分钟</option>)}</select></label><p className="phase-play-note">整局倒计时结束后自动停止。词库不够时允许重复，不阻止开始游戏。</p><p className="phase-play-note">红灯停止、黄灯放慢、绿灯继续。切换顺序可自行选择。</p><label>切换方式<select aria-label="切换方式" value={s.mode} onChange={e=>setting({mode:e.target.value as PhaseSettings['mode']})}><option value="sequence">顺序切换</option><option value="random">随机切换</option></select></label><label className="phase-play-toggle">随机阶段时长<input type="checkbox" aria-label="随机阶段时长" checked={s.randomDuration} onChange={e=>setting({randomDuration:e.target.checked})}/></label></div>}
  {tab==='玩法'&&<div className="phase-play-tone-settings">
 <label className="phase-play-tone-card"><span><strong>甜宠模式</strong><small>温柔鼓励、亲昵称呼，语气更柔和</small></span><input type="checkbox" aria-label="甜宠模式" checked={!!s.sweetMode} onChange={e=>setting({sweetMode:e.target.checked,commandMode:e.target.checked?false:s.commandMode})}/></label>
 <label className="phase-play-tone-card"><span><strong>强势模式</strong><small>简短直接、有主导感，但随时可以暂停</small></span><input type="checkbox" aria-label="强势模式" checked={!!s.commandMode} onChange={e=>setting({commandMode:e.target.checked,sweetMode:e.target.checked?false:s.sweetMode})}/></label>
 <div className="phase-play-card"><label>对方的称呼<input aria-label="对方的称呼" maxLength={30} value={s.address??''} placeholder="选填" onChange={e=>setting({address:e.target.value})}/></label><label>语气强度<select aria-label="语气强度" value={s.intensity??'medium'} onChange={e=>setting({intensity:e.target.value as NonNullable<PhaseSettings['intensity']>})}><option value="soft">微辣 · 温柔</option><option value="medium">中辣 · 明确</option><option value="strong">特辣 · 冷静直接</option><option value="dramatic">戏剧化 · 强烈氛围</option></select></label><p className="phase-play-note">强度只调整文案风格，不改变灯光时间或暂停权限。</p></div>
 </div>}
 {tab==='节奏'&&<div className="phase-play-card"><h3>灯光节奏</h3><p className="phase-play-note">默认红灯最短。调整每种灯光的持续时间。</p>
  {(['green','yellow','red'] as const).map(p=><div className="phase-play-duration" data-color={p} key={p}><strong>{phaseNames[p]}</strong>{(s.randomDuration?['min','max']:['seconds']).map(k=><label key={k}>{k==='min'?'最短':k==='max'?'最长':'时长'}<input aria-label={phaseNames[p]+(k==='min'?'最短秒数':k==='max'?'最长秒数':'秒数')} type="number" min={1} max={600} step={1} value={s.duration[p][k as 'seconds'|'min'|'max']} onChange={e=>setting({duration:{...s.duration,[p]:{...s.duration[p],[k]:Number(e.target.value)}}})}/></label>)}</div>)}
  <label>节拍速度 · {s.bpm} BPM<input aria-label="节拍速度" type="range" min={30} max={180} step={1} value={s.bpm} onChange={e=>setting({bpm:Number(e.target.value)})}/></label><label className="phase-play-toggle">自动加速节拍<input type="checkbox" aria-label="自动加速节拍" checked={!!s.autoAccelerate} onChange={e=>setting({autoAccelerate:e.target.checked})}/></label>{s.autoAccelerate&&<><label>加速目标 · {s.maxBpm??120} BPM<input aria-label="加速目标BPM" type="range" min={s.bpm} max={180} value={Math.max(s.bpm,s.maxBpm??120)} onChange={e=>setting({maxBpm:Number(e.target.value)})}/></label><label>加速所需秒数<input aria-label="加速所需秒数" type="number" min={10} max={3600} value={s.accelerationSeconds??120} onChange={e=>setting({accelerationSeconds:Number(e.target.value)})}/></label></>}<p className="phase-play-note">自动加速只影响节拍声和灯光脉冲，不改变红黄绿阶段持续时间。</p></div>}
  {tab==='指令'&&<div className="phase-play-card"><h3>指令来源</h3>
 <div className="phase-play-mode-options"><label><input type="radio" name="phase-instruction-mode" checked={(s.instructionMode??'default')==='default'} onChange={()=>setting({instructionMode:'default'})}/> 默认指令</label><label><input type="radio" name="phase-instruction-mode" checked={s.instructionMode==='character'} onChange={()=>setting({instructionMode:'character'})}/> 根据角色生成指令</label></div>
 {s.instructionMode==='character'&&<div className="phase-play-character-settings"><label>选择角色<select aria-label="指令角色" value={s.instructionCharacterId??''} onChange={e=>{setEditId(null);setText('');setting({instructionCharacterId:e.target.value});}}><option value="">请选择角色</option>{characters.map(character=><option key={character.id} value={character.id}>{character.name}</option>)}</select></label><label>世界设定（可选）<select aria-label="指令世界" value={s.instructionWorldId??''} onChange={e=>{setEditId(null);setText('');setting({instructionWorldId:e.target.value});}}><option value="">仅角色基础人设</option>{worldOptions.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><p className="phase-play-note">每次生成30条角色专属台词（红黄绿各10条）；按当前输出上限分批调用，会消耗 API 额度，游戏中按阶段随机抽取。可编辑、删除、新增或重新生成；更新时保留最近10份旧版本，不写入聊天记忆。</p><button type="button" disabled={generating||!s.instructionCharacterId} onClick={()=>void generateCharacterLibrary()}>{generating?progress||'正在生成…':'AI 追加30条指令'}</button><button type="button" disabled={generating||!s.instructionCharacterId} onClick={()=>void generateCharacterLibrary(true)}>重新生成30条指令</button>{generating&&<button type="button" onClick={()=>generationController.current?.abort()}>取消生成</button>}<button type="button" disabled={generating||!s.instructionCharacterId} onClick={makeCharacterDraft}>建立基础草稿（不调用 AI）</button><button type="button" onClick={()=>setShowInstructionCards(v=>!v)}>{showInstructionCards?'收起角色指令卡片':'查看角色指令卡片'}</button>{versions.length>0&&<div className="phase-play-versions"><h4>历史版本</h4>{versions.slice().reverse().map((version,i)=><div key={version.savedAt+'-'+i} className="phase-play-version"><small>{new Date(version.savedAt).toLocaleString('zh-CN')} · {version.prompts.length} 条</small><button type="button" onClick={()=>{if(!confirm('恢复此版本将替换当前角色指令，其他角色不变。确定吗？'))return;const restored=replaceLibrary(current.current,scopePrefix,version.prompts,versions);if(!validData(restored)){setError('历史版本数据无效，未恢复。');return;}try{savePhaseData(db.name,restored);current.current=restored;setData(restored);setError('');setNotice('已恢复选定的历史版本。');}catch(e){setError(e instanceof Error?e.message:'恢复失败。');}}}>恢复此版本</button></div>)}</div>}</div>}
 <p className="phase-play-note">默认指令自动从内置库抽取；角色模式使用选定角色已保存的指令。下方可以编辑指令。</p><label>适用阶段<select aria-label="提示适用阶段" value={scope} onChange={e=>setScope(e.target.value as Phase|'all')}><option value="all">所有阶段</option>{phases.map(p=><option key={p} value={p}>{phaseNames[p]}</option>)}</select></label><label>附加提示<textarea aria-label="提示文本" maxLength={1000} value={text} onChange={e=>setText(e.target.value)} placeholder="选填：增加自己的提示"/></label><div className="phase-play-actions"><button disabled={!text.trim()} onClick={savePrompt}>{editId?'保存修改':'添加提示'}</button>{editId&&<button onClick={()=>{setEditId(null);setText('');}}>取消编辑</button>}</div>{(s.instructionMode!=='character'||showInstructionCards)&&<ul aria-label={s.instructionMode==='character'?'角色指令卡片':'已保存指令'}>{s.prompts.filter(p=>s.instructionMode==='character'?p.id.startsWith(scopePrefix):!p.id.startsWith('character:')).map(p=><li key={p.id}><small>{p.phase==='all'?'所有阶段':phaseNames[p.phase]}</small><p>{p.text}</p><div className="phase-play-actions"><button onClick={()=>{setEditId(p.id);setText(p.text);setScope(p.phase);}}>编辑提示</button><button onClick={()=>{const updated=replaceLibrary(current.current,selectedScope(s),scopePrompts(s).filter(x=>x.id!==p.id),versions);try{savePhaseData(db.name,updated);current.current=updated;setData(updated);setError('');if(editId===p.id){setEditId(null);setText('');}setNotice('指令已删除。');}catch(e){setError(e instanceof Error?e.message:'删除失败。');}}}>删除提示</button></div></li>)}</ul>}</div>}
  {tab==='其他'&&<div className="phase-play-card"><h3>声音与反馈</h3><label className="phase-play-toggle">节拍反馈<input type="checkbox" checked={s.beat} onChange={e=>setting({beat:e.target.checked})}/></label><label className="phase-play-toggle">音效<input type="checkbox" aria-label="音效" checked={s.sound} onChange={e=>{setting({sound:e.target.checked});if(e.target.checked)void feedback.current!.unlock().then(ok=>{if(!ok)setNotice('音频不可用，计时仍可正常使用。');});else feedback.current?.stop();}}/></label><label>音量 · {Math.round(s.volume*100)}%<input aria-label="音量" type="range" min={0} max={100} step={5} value={Math.round(s.volume*100)} onChange={e=>setting({volume:Number(e.target.value)/100})}/></label><label className="phase-play-toggle">震动反馈<input type="checkbox" checked={s.vibration} onChange={e=>setting({vibration:e.target.checked})}/></label><p className="phase-play-note">{typeof navigator.vibrate==='function'?'设备提供震动接口，实际效果取决于浏览器。':'此浏览器未提供震动接口，将只使用可用的声音与视觉反馈。'}</p></div>}
  </fieldset>
  <button className="phase-play-primary phase-play-start" disabled={blocked||running||generating} onClick={()=>void enter()}>我准备好了 · 开始</button>
  {r.status==='paused'&&<button className="phase-play-resume" onClick={()=>setScreen('running')}>查看上次暂停的游戏</button>}
  <p className="phase-play-note">设置保存在当前浏览器。切换后台或锁屏后会暂停；本应用数据尚未纳入 ZIP 备份。</p>
 </>:<>
  <div className="phase-play-stage" data-phase={r.phase}><span className="phase-play-orb" aria-hidden="true"><span key={pulse} className="phase-play-orb-pulse" data-active={pulse>0&&running&&s.beat} /></span><strong>{phaseNames[r.phase]}</strong><output aria-label="阶段剩余时间">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</output><span key={pulse} className="phase-play-beat" data-active={pulse>0&&running&&s.beat} role="img" aria-label="节拍指示"/><small>{r.status==='idle'?'准备开始':r.status==='paused'?'已暂停':r.status==='finished'?'本局结束':'进行中'} · 第 {r.step} 阶段 · {Math.round(bpmAt(s,r.elapsedMs??0))} BPM</small></div>
  <div className="phase-play-instruction"><small>本局剩余时间：<output aria-label="整局剩余时间">{String(Math.floor(gameSeconds/60)).padStart(2,'0')}:{String(gameSeconds%60).padStart(2,'0')}</output></small><small>当前指令</small><p className="phase-play-prompt">{r.prompt||'准备好后，点击开始。'}</p></div>
  <div className="phase-play-actions"><button className="phase-play-primary" disabled={blocked} onClick={()=>running?pause():void run()}>{running?'暂停':r.status==='idle'||r.status==='finished'?'开始新一局':'继续'}</button><button disabled={blocked||r.status==='idle'||r.status==='finished'} onClick={()=>{change({...current.current,session:next(s,current.current.session)});}}>下一阶段</button></div>
  <div className="phase-play-actions"><button disabled={blocked} onClick={()=>{pause();change({...current.current,session:initial(s)});}}>重置计时</button><button onClick={exit}>快速退出</button></div>
 </>}
 </section>;
}
