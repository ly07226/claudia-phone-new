import {useEffect,useRef,useState} from 'react';
import {db} from '../store';
import {baseInstructions} from './instructions';
import {advance,defaults,initial,next,phases,phaseNames,start,type Phase,type PhaseData,type PhaseSettings,validData} from './engine';
import {loadPhaseData,savePhaseData} from './storage';
import {PhaseFeedback} from './feedback';
import './phasePlay.css';
export function PhasePlayApp({onBack}:{onBack:()=>void}){
 const [characters,setCharacters]=useState<{id:string;name:string}[]>([]);
 useEffect(()=>{let active=true;void db.characters.toArray().then(rows=>{if(active)setCharacters(rows.map(x=>({id:x.id,name:x.name})));});return()=>{active=false;};},[]);
 const [screen,setScreen]=useState<'settings'|'running'>('settings'),[tab,setTab]=useState<'玩法'|'节奏'|'指令'|'其他'>('节奏');
 const [loaded]=useState(()=>loadPhaseData(db.name)),[data,setData]=useState(loaded.data),[error,setError]=useState(loaded.error),[blocked,setBlocked]=useState(!!loaded.error),[notice,setNotice]=useState(''),[editId,setEditId]=useState<string|null>(null),[text,setText]=useState(''),[scope,setScope]=useState<Phase|'all'>('all'),[pulse,setPulse]=useState(0);
 const current=useRef(data),feedback=useRef<PhaseFeedback|null>(null),last=useRef(performance.now()),saved=useRef(0),beat=useRef(0);
 if(!feedback.current)feedback.current=new PhaseFeedback();
 function persist(value:PhaseData){try{savePhaseData(db.name,value);return true;}catch(e){setError((e as Error).message);return false;}}
 function change(value:PhaseData,save=true){if(blocked)return;if(!validData(value)){setError('请输入有效设置：时长 1～600 秒，随机最短不超过最长。');return;}current.current=value;setData(value);if(save){setError('');persist(value);}}
 function pause(message=''){const d=current.current;if(d.session.status==='running'){const value={...d,session:{...d.session,status:'paused' as const}};current.current=value;setData(value);persist(value);}feedback.current?.stop();if(message)setNotice(message);}
 useEffect(()=>{
  const interval=window.setInterval(()=>{
   const now=performance.now(),elapsed=now-last.current;last.current=now;const d=current.current;
   if(d.session.status!=='running')return;
   if(document.hidden||elapsed>1500){pause('应用已暂停，请确认后继续。');return;}
   const value={...d,session:advance(d.settings,d.session,elapsed)};current.current=value;setData(value);
   if(d.settings.beat&&now-beat.current>=60000/d.settings.bpm){beat.current=now;setPulse(x=>x+1);feedback.current?.pulse(d.settings.sound,d.settings.volume,d.settings.vibration);}
   if(now-saved.current>=1000){saved.current=now;persist(value);}
  },100);
  const visibility=()=>{if(document.hidden)pause('离开前台后已暂停，返回时请主动继续。');};
  const leave=()=>pause();document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leave);window.addEventListener('beforeunload',leave);
  return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);window.removeEventListener('beforeunload',leave);const d=current.current;if(d.session.status==='running'){const value={...d,session:{...d.session,status:'paused' as const}};try{savePhaseData(db.name,value);}catch{/* Do not touch any other storage on exit. */}}feedback.current?.dispose();};
 },[]);
 async function run(){if(blocked)return;const d=current.current;const value={...d,session:d.session.status==='idle'?start(d.settings):{...d.session,status:'running' as const}};last.current=performance.now();beat.current=last.current;change(value);setNotice('');if(d.settings.sound&&!await feedback.current!.unlock())setNotice('此浏览器暂未启用音频，计时正常。可关闭音效后重新开启。');}
 function setting(patch:Partial<PhaseSettings>){change({...current.current,settings:{...current.current.settings,...patch}});}
 const s=data.settings,r=data.session,seconds=Math.ceil(r.remainingMs/1000),running=r.status==='running';
 const exit=()=>{pause();onBack();};
 const enter=async()=>{await run();setScreen('running');};
 const backToSettings=()=>{pause();setScreen('settings');};
 function makeCharacterDraft(){
  const id=s.instructionCharacterId;
  if(!id)return setError('请先选择角色。');
  const existing=s.prompts.filter(p=>p.id.startsWith('character:'+id+':'));
  if(existing.length&&!confirm('将重新建立此角色的基础指令草稿，覆盖此前编辑的角色指令。继续吗？'))return;
  const others=s.prompts.filter(p=>!p.id.startsWith('character:'+id+':'));
  const drafted=baseInstructions.map(item=>({id:'character:'+id+':'+item.id,phase:item.phase,text:item.text}));
  if(others.length+drafted.length>100)return setError('指令数量超出100条限制。');
  setting({prompts:[...others,...drafted],instructionMode:'character'});
  setNotice('已建立可编辑的角色指令草稿。AI 人设生成尚未接通，这些是基础文案，不是 AI 生成结果。');
 }
 function savePrompt(){if(!text.trim())return setError('请输入提示文本。');if(!editId&&s.prompts.length>=100)return setError('最多保存 100 条提示。');const item={id:editId??(s.instructionMode==='character'?'character:'+(s.instructionCharacterId||'unselected')+':'+crypto.randomUUID():crypto.randomUUID()),phase:scope,text};setting({prompts:editId?s.prompts.map(p=>p.id===editId?item:p):[...s.prompts,item]});setEditId(null);setText('');}
 return <section className="phase-play" aria-label="忍一下嘛应用" data-screen={screen}>
 <header className="phase-play-heading"><div><h2>忍一下嘛</h2><p>{screen==='settings'?'选择玩法与节奏，再开启一场游戏':'跟随灯光与指令，按自己的节奏来'}</p></div><button onClick={screen==='running'?backToSettings:exit}>{screen==='running'?'返回设置':'退出应用'}</button></header>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {blocked&&<button onClick={()=>{if(!confirm('只重置忍一下嘛的本地记录，其他数据不变。继续吗？'))return;const settings=defaults(),value:PhaseData={version:1,settings,session:initial(settings)};if(persist(value)){current.current=value;setData(value);setBlocked(false);setError('');}}}>重置本应用记录</button>}
 {screen==='settings'?<>
  <nav className="phase-play-tabs" aria-label="设置分类">{(['玩法','节奏','指令','其他'] as const).map(name=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}>{name}</button>)}</nav>
  <fieldset disabled={running||blocked} className="phase-play-settings">
  {tab==='玩法'&&<div className="phase-play-card"><h3>游戏方式</h3><p className="phase-play-note">红灯停止、黄灯放慢、绿灯继续。切换顺序可自行选择。</p><label>切换方式<select aria-label="切换方式" value={s.mode} onChange={e=>setting({mode:e.target.value as PhaseSettings['mode']})}><option value="sequence">顺序切换</option><option value="random">随机切换</option></select></label><label className="phase-play-toggle">随机阶段时长<input type="checkbox" aria-label="随机阶段时长" checked={s.randomDuration} onChange={e=>setting({randomDuration:e.target.checked})}/></label></div>}
  {tab==='玩法'&&<div className="phase-play-tone-settings">
 <label className="phase-play-tone-card"><span><strong>甜宠模式</strong><small>温柔鼓励、亲昵称呼，语气更柔和</small></span><input type="checkbox" aria-label="甜宠模式" checked={!!s.sweetMode} onChange={e=>setting({sweetMode:e.target.checked,commandMode:e.target.checked?false:s.commandMode})}/></label>
 <label className="phase-play-tone-card"><span><strong>强势模式</strong><small>简短直接、有主导感，但随时可以暂停</small></span><input type="checkbox" aria-label="强势模式" checked={!!s.commandMode} onChange={e=>setting({commandMode:e.target.checked,sweetMode:e.target.checked?false:s.sweetMode})}/></label>
 <div className="phase-play-card"><label>对方的称呼<input aria-label="对方的称呼" maxLength={30} value={s.address??''} placeholder="选填" onChange={e=>setting({address:e.target.value})}/></label><label>语气强度<select aria-label="语气强度" value={s.intensity??'medium'} onChange={e=>setting({intensity:e.target.value as NonNullable<PhaseSettings['intensity']>})}><option value="soft">微辣 · 温柔</option><option value="medium">中辣 · 明确</option><option value="strong">特辣 · 冷静直接</option><option value="dramatic">戏剧化 · 强烈氛围</option></select></label><p className="phase-play-note">强度只调整文案风格，不改变灯光时间或暂停权限。</p></div>
 </div>}
 {tab==='节奏'&&<div className="phase-play-card"><h3>灯光节奏</h3><p className="phase-play-note">默认红灯最短。调整每种灯光的持续时间。</p>
  {(['green','yellow','red'] as const).map(p=><div className="phase-play-duration" data-color={p} key={p}><strong>{phaseNames[p]}</strong>{(s.randomDuration?['min','max']:['seconds']).map(k=><label key={k}>{k==='min'?'最短':k==='max'?'最长':'时长'}<input aria-label={phaseNames[p]+(k==='min'?'最短秒数':k==='max'?'最长秒数':'秒数')} type="number" min={1} max={600} step={1} value={s.duration[p][k as 'seconds'|'min'|'max']} onChange={e=>setting({duration:{...s.duration,[p]:{...s.duration[p],[k]:Number(e.target.value)}}})}/></label>)}</div>)}
  <label>节拍速度 · {s.bpm} BPM<input aria-label="节拍速度" type="range" min={30} max={180} step={1} value={s.bpm} onChange={e=>setting({bpm:Number(e.target.value)})}/></label></div>}
  {tab==='指令'&&<div className="phase-play-card"><h3>指令来源</h3>
 <div className="phase-play-mode-options"><label><input type="radio" name="phase-instruction-mode" checked={(s.instructionMode??'default')==='default'} onChange={()=>setting({instructionMode:'default'})}/> 默认指令</label><label><input type="radio" name="phase-instruction-mode" checked={s.instructionMode==='character'} onChange={()=>setting({instructionMode:'character'})}/> 根据角色生成指令</label></div>
 {s.instructionMode==='character'&&<div className="phase-play-character-settings"><label>选择角色<select aria-label="指令角色" value={s.instructionCharacterId??''} onChange={e=>setting({instructionCharacterId:e.target.value})}><option value="">请选择角色</option>{characters.map(character=><option key={character.id} value={character.id}>{character.name}</option>)}</select></label><p className="phase-play-note">每个角色的指令独立保存，可长期使用、编辑和重新建立。当前尚未接入 AI 生成人设的调用；先提供可编辑的基础草稿，不会冒充 AI 结果。</p><button type="button" onClick={makeCharacterDraft}>建立／更新角色指令草稿</button></div>}
 <p className="phase-play-note">默认指令自动从内置库抽取；角色模式使用选定角色已保存的指令。下方可以编辑指令。</p><label>适用阶段<select aria-label="提示适用阶段" value={scope} onChange={e=>setScope(e.target.value as Phase|'all')}><option value="all">所有阶段</option>{phases.map(p=><option key={p} value={p}>{phaseNames[p]}</option>)}</select></label><label>附加提示<textarea aria-label="提示文本" maxLength={1000} value={text} onChange={e=>setText(e.target.value)} placeholder="选填：增加自己的提示"/></label><div className="phase-play-actions"><button disabled={!text.trim()} onClick={savePrompt}>{editId?'保存修改':'添加提示'}</button>{editId&&<button onClick={()=>{setEditId(null);setText('');}}>取消编辑</button>}</div><ul>{s.prompts.filter(p=>s.instructionMode==='character'?p.id.startsWith('character:'+(s.instructionCharacterId||'unselected')+':'):!p.id.startsWith('character:')).map(p=><li key={p.id}><small>{p.phase==='all'?'所有阶段':phaseNames[p.phase]}</small><p>{p.text}</p><div className="phase-play-actions"><button onClick={()=>{setEditId(p.id);setText(p.text);setScope(p.phase);}}>编辑提示</button><button onClick={()=>{setting({prompts:s.prompts.filter(x=>x.id!==p.id)});if(editId===p.id){setEditId(null);setText('');}}}>删除提示</button></div></li>)}</ul></div>}
  {tab==='其他'&&<div className="phase-play-card"><h3>声音与反馈</h3><label className="phase-play-toggle">节拍反馈<input type="checkbox" checked={s.beat} onChange={e=>setting({beat:e.target.checked})}/></label><label className="phase-play-toggle">音效<input type="checkbox" aria-label="音效" checked={s.sound} onChange={e=>{setting({sound:e.target.checked});if(e.target.checked)void feedback.current!.unlock().then(ok=>{if(!ok)setNotice('音频不可用，计时仍可正常使用。');});else feedback.current?.stop();}}/></label><label>音量 · {Math.round(s.volume*100)}%<input aria-label="音量" type="range" min={0} max={100} step={5} value={Math.round(s.volume*100)} onChange={e=>setting({volume:Number(e.target.value)/100})}/></label><label className="phase-play-toggle">震动反馈<input type="checkbox" checked={s.vibration} onChange={e=>setting({vibration:e.target.checked})}/></label><p className="phase-play-note">{typeof navigator.vibrate==='function'?'设备提供震动接口，实际效果取决于浏览器。':'此浏览器未提供震动接口，将只使用可用的声音与视觉反馈。'}</p></div>}
  </fieldset>
  <button className="phase-play-primary phase-play-start" disabled={blocked||running} onClick={()=>void enter()}>我准备好了 · 开始</button>
  {r.status==='paused'&&<button className="phase-play-resume" onClick={()=>setScreen('running')}>查看上次暂停的游戏</button>}
  <p className="phase-play-note">设置保存在当前浏览器。切换后台或锁屏后会暂停；本应用数据尚未纳入 ZIP 备份。</p>
 </>:<>
  <div className="phase-play-stage" data-phase={r.phase}><span className="phase-play-orb" aria-hidden="true"/><strong>{phaseNames[r.phase]}</strong><output aria-label="阶段剩余时间">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</output><span key={pulse} className="phase-play-beat" data-active={running&&s.beat} role="img" aria-label="节拍指示"/><small>{r.status==='idle'?'准备开始':r.status==='paused'?'已暂停':'进行中'} · 第 {r.step} 阶段</small></div>
  <div className="phase-play-instruction"><small>当前指令</small><p className="phase-play-prompt">{r.prompt||'准备好后，点击开始。'}</p></div>
  <div className="phase-play-actions"><button className="phase-play-primary" disabled={blocked} onClick={()=>running?pause():void run()}>{running?'暂停':r.status==='idle'?'开始':'继续'}</button><button disabled={blocked||r.status==='idle'} onClick={()=>{change({...current.current,session:next(s,current.current.session)});beat.current=performance.now();}}>下一阶段</button></div>
  <div className="phase-play-actions"><button disabled={blocked} onClick={()=>{pause();change({...current.current,session:initial(s)});}}>重置计时</button><button onClick={exit}>快速退出</button></div>
 </>}
 </section>;
}
