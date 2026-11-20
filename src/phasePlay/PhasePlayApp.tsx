import {ChatLinkSettings} from './ChatLinkSettings';
import {preparePhaseChatRun,dispatchPhaseChatEvent,phaseChatEvent} from './chatLink';
import {InterventionToast} from './InterventionToast';
import {PhaseMp3Upload,startPhaseMp3,stopPhaseMp3} from './PhaseMp3Upload';
import {generateInterventions,InterventionError} from './interventionGeneration';
import {interventionScope,triggerIntervention,type InterventionNotice} from './interventions';
import {talkInstructions,talkMode,type TalkMode} from './phaseTalkLibraries';
import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {db} from '../store';
import {baseInstructions} from './instructions';
import {bpmAt,beatCount,advance,defaults,initial,next,reroll,phases,phaseNames,start,type Phase,type PhaseData,type PhaseSettings,validData} from './engine';
import {loadPhaseData,savePhaseData,savePhaseSession} from './storage';
import {PhaseFeedback} from './feedback';
import {reconcileApiDefault} from '../apiSelection';
import {mergeLibraryVersions,normalizedInstruction,replaceLibrary,scopePrompts,selectedScope} from './library';
import {generateLibrary} from './generation';
import {readPhaseInstructionWord} from './wordInstructionImport';
import './phasePlay.css';
export function PhasePlayApp({onBack}:{onBack:()=>void}){
 const anchor=useRef<HTMLElement|null>(null);
 const [interventionNotice,setInterventionNotice]=useState<InterventionNotice|null>(null);
 const clearInterventionNotice=useCallback(()=>setInterventionNotice(null),[]);
 const [interventionGenerating,setInterventionGenerating]=useState(false),[interventionError,setInterventionError]=useState('');
 const interventionController=useRef<AbortController|null>(null);
 const [wordImporting,setWordImporting]=useState(false);
 const [wordProgress,setWordProgress]=useState<{stage:'reading'|'classifying'|'done';processed:number;total:number}|null>(null);
 const [wordPreview,setWordPreview]=useState<{target:'character'|TalkMode;items:{phase:Phase;text:string}[];snapshot:PhaseData}|null>(null);
 const [generating,setGenerating]=useState(false);
 const [generationError,setGenerationError]=useState('');
 const generationController=useRef<AbortController|null>(null);
 const [progress,setProgress]=useState('');
 const [showInstructionCards,setShowInstructionCards]=useState(false);
 const [defaultEditing,setDefaultEditing]=useState<{mode:TalkMode;id:string|null;phase:Phase;text:string}|null>(null);
 const [worldOptions,setWorldOptions]=useState<{id:string;name:string}[]>([]);
 const [versions,setVersions]=useState<{savedAt:number;prompts:{id:string;phase:Phase|'all';text:string}[]}[]>([]);
 const [characters,setCharacters]=useState<{id:string;name:string}[]>([]);
 useEffect(()=>{let active=true;void db.characters.toArray().then(rows=>{if(active)setCharacters(rows.map(x=>({id:x.id,name:x.name})));});return()=>{active=false;};},[]);
 useEffect(()=>{let active=true;void db.worlds.toArray().then(rows=>{if(active)setWorldOptions(rows.map(w=>({id:w.id,name:w.name})));});return()=>{active=false;};},[]);
 const [audioSource,setAudioSource]=useState<'metronome'|'mp3'>(()=>localStorage.getItem('claudia.phasePlay.audioSource:'+db.name)==='mp3'?'mp3':'metronome');
 const audioSourceRef=useRef(audioSource);audioSourceRef.current=audioSource;
 const [screen,setScreen]=useState<'settings'|'running'>('settings'),[tab,setTab]=useState<'玩法'|'节奏'|'指令'|'其他'>('节奏');
 const [loaded]=useState(()=>loadPhaseData(db.name)),[data,setData]=useState(loaded.data),[error,setError]=useState(loaded.error),[blocked,setBlocked]=useState(!!loaded.error),[notice,setNotice]=useState(''),[editId,setEditId]=useState<string|null>(null),[text,setText]=useState(''),[scope,setScope]=useState<Phase|'all'>('all'),[pulse,setPulse]=useState(0),[pulsePhase,setPulsePhase]=useState<Phase|null>(null);
 useEffect(()=>{const id=data?.settings?.instructionCharacterId;if(data.settings.instructionMode!=='character'){setVersions(data.libraryVersions?.default??[]);return;}if(!id){setVersions([]);return;}try{const rows=JSON.parse(localStorage.getItem('claudia.phasePlay.versions.v2:'+db.name+':'+encodeURIComponent(id)+':'+encodeURIComponent(data.settings.instructionWorldId??''))||'[]');setVersions(mergeLibraryVersions(data.libraryVersions?.[selectedScope(data.settings)]??[],Array.isArray(rows)?rows.filter(v=>v&&Number.isFinite(v.savedAt)&&Array.isArray(v.prompts)&&v.prompts.every((p:unknown)=>!!p&&typeof p==='object'&&'id' in p&&typeof p.id==='string'&&p.id.startsWith(selectedScope(data.settings))&&'text' in p&&typeof p.text==='string')):[]));}catch{setVersions([]);}},[data?.settings?.instructionMode,data?.settings?.instructionCharacterId,data?.settings?.instructionWorldId,data?.settings?.prompts,data.libraryVersions]);
 const starting=useRef(false),alive=useRef(true);
 const linkEvent=(run:NonNullable<PhaseData['session']['chatLink']>,type:'start'|'finish')=>{void dispatchPhaseChatEvent(phaseChatEvent(run,type)).catch(()=>{if(alive.current)setNotice('角色联动未完成，游戏继续；可在对应聊天查看失败原因，未自动重试。');});};
 const current=useRef(data),feedback=useRef<PhaseFeedback|null>(null),last=useRef(performance.now()),saved=useRef(0);
 if(!feedback.current)feedback.current=new PhaseFeedback();
 function persist(value:PhaseData){try{savePhaseData(db.name,value);return true;}catch(e){setError((e as Error).message);return false;}}
 function change(value:PhaseData,save=true){if(blocked)return false;if(!validData(value)){setError('请输入有效设置：时长 1～600 秒，随机最短不超过最长。');return false;}if(save){setError('');if(!persist(value))return false;}current.current=value;setData(value);return true;}
 function pause(message=''){setInterventionNotice(null);setPulse(0);const d=current.current;if(d.session.status==='running'){const value={...d,session:{...d.session,status:'paused' as const}};current.current=value;setData(value);persist(value);}feedback.current?.stop();stopPhaseMp3();if(message)setNotice(message);}
 useEffect(()=>{
  alive.current=true;
  const interval=window.setInterval(()=>{
   const now=performance.now(),elapsed=now-last.current;last.current=now;const d=current.current;
   if(d.session.status!=='running')return;
   if(document.hidden||elapsed>1500){pause('应用已暂停，请确认后继续。');return;}
   let value={...d,session:advance(d.settings,d.session,elapsed)};
   const intervention=triggerIntervention(d.settings,value.session,bpmAt(d.settings,value.session.elapsedMs??0,value.session.bpmOffset??0));
   if(intervention){const updated={...value,session:intervention.session};try{savePhaseData(db.name,updated);}catch{pause('临场变化未能保存，已暂停；未应用该事件。');return;}value=updated;setInterventionNotice(intervention.notice);}
   current.current=value;setData(value);
   if(value.session.status==='finished'){if(persist(value)&&value.session.chatLink)linkEvent(value.session.chatLink,'finish');setInterventionNotice(null);feedback.current?.stop();stopPhaseMp3();setNotice('本局时间已到，游戏结束。');persist(value);return;}
   if(value.session.phase==='red'){feedback.current?.silence();}else if(d.settings.beat&&beatCount(d.settings,value.session)>beatCount(d.settings,d.session)){setPulsePhase(value.session.phase);setPulse(x=>x+1);feedback.current?.pulse(audioSourceRef.current==='metronome'&&d.settings.sound,d.settings.volume,d.settings.vibration);}
   if(now-saved.current>=1000){saved.current=now;try{savePhaseSession(db.name,value);}catch{pause("进度保存失败，已暂停；原词库保留。");}}
  },50);
  const visibility=()=>{if(document.hidden){generationController.current?.abort();interventionController.current?.abort();pause('离开前台后已暂停，返回时请主动继续。');}};
  const leave=()=>{generationController.current?.abort();interventionController.current?.abort();pause();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leave);window.addEventListener('beforeunload',leave);
  return()=>{alive.current=false;generationController.current?.abort();interventionController.current?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leave);window.removeEventListener('beforeunload',leave);const d=current.current;if(d.session.status==='running'){const value={...d,session:{...d.session,status:'paused' as const}};try{savePhaseData(db.name,value);}catch{/* Do not touch any other storage on exit. */}}feedback.current?.dispose();stopPhaseMp3();};
 },[]);
 async function run(){
  if(blocked||starting.current)return;starting.current=true;
  try{
   setPulse(0);const d=current.current;const audioReady=audioSourceRef.current==='metronome'&&d.settings.sound?feedback.current!.unlock():undefined;const isNew=d.session.status==='idle'||d.session.status==='finished';
   let binding:Awaited<ReturnType<typeof preparePhaseChatRun>>;
   if(isNew){try{binding=await preparePhaseChatRun(d.settings);}catch{setNotice('角色绑定暂不可用，将无联动继续游戏。');}}
   if(!alive.current||current.current!==d)return;
   const resumed=talkMode(d.settings)&&d.session.draws?.[d.session.phase]?.scope!=='default:'+talkMode(d.settings)?reroll(d.settings,d.session):d.session;
   const value={...d,session:isNew?{...start(d.settings,Math.random,d.interventionPool),...(binding?{chatLink:binding}:{})}:{...resumed,status:'running' as const}};
   last.current=performance.now();if(!change(value))return;setNotice('');
   if(isNew&&binding)linkEvent(binding,'start');
   if(audioSourceRef.current==='mp3'){if(!await startPhaseMp3())setNotice('MP3 未能播放，请先上传文件并允许浏览器播放音频。');}else if(audioReady&&!await audioReady)setNotice('此浏览器暂未启用音频，计时正常。可关闭音效后重新开启。');
  }finally{starting.current=false;}
 }

 function setting(patch:Partial<PhaseSettings>){generationController.current?.abort();if(['instructionCharacterId','instructionWorldId','sweetMode','commandMode','intensity','aiIntervention'].some(k=>k in patch))interventionController.current?.abort();const d=current.current,settings={...d.settings,...patch},reset=['duration','mode','randomDuration','gameMinutes','instructionMode','instructionCharacterId','instructionWorldId','sweetMode','commandMode'].some(key=>key in patch);if(change({...d,settings,session:reset&&d.session.status==='paused'?initial(settings):{...d.session,...('bpm' in patch||'autoAccelerate' in patch?{bpmOffset:0}:{}),...(patch.aiIntervention===false&&d.session.intervention?{intervention:{...d.session.intervention,nextPhase:undefined}}:{})}})&&reset&&d.session.status==='paused')setNotice('玩法或词库已改变，下次开始新一局。');}
 const s=data.settings,r=data.session,scopePrefix='character:'+encodeURIComponent(s.instructionCharacterId??'')+':'+encodeURIComponent(s.instructionWorldId??'')+':',seconds=Math.ceil(r.remainingMs/1000),gameSeconds=Math.ceil((r.gameRemainingMs??(s.gameMinutes??10)*60000)/1000),running=r.status==='running';
 const exit=()=>{generationController.current?.abort();interventionController.current?.abort();pause();onBack();};
 const enter=async()=>{await run();if(current.current.session.status==='running')setScreen('running');};
 const backToSettings=()=>{pause();setScreen('settings');};
 async function generateCharacterLibrary(replace=false){
  const snapshot=current.current,id=snapshot.settings.instructionCharacterId;
  if(!id||generationController.current)return setError('请先选择角色，或等待当前生成完成。');
  const scope=selectedScope(snapshot.settings),previous=scopePrompts(snapshot.settings,scope);
  if(replace&&previous.length&&!confirm('重新生成将替换当前组合词库，并保留旧版本。继续吗？'))return;
  const controller=new AbortController();generationController.current=controller;setGenerating(true);setError('');setGenerationError('');
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
  }catch(e){const message=e instanceof Error?e.message:'未知错误，原词库保留。';setGenerationError(message);setError('生成30条指令失败，详见生成按钮上方的原因。');}
  finally{generationController.current=null;setGenerating(false);setProgress('');}
 }
 async function prepareEvents(){
  const snapshot=current.current;if(!snapshot.settings.aiIntervention||interventionController.current)return;
  const controller=new AbortController();interventionController.current=controller;setInterventionGenerating(true);setInterventionError('');
  try{
   const id=snapshot.settings.instructionCharacterId;if(!id)throw new InterventionError('请先选择干预角色；不准备事件也可正常游戏。');
   const character=await db.characters.get(id);if(!character)throw new InterventionError('所选角色不存在，可无事件继续游戏。');
   const config=character.apiConfigId?await db.apiConfigs.get(character.apiConfigId):(await reconcileApiDefault()).config;
   if(!config?.enabled)throw new InterventionError('没有完整可用的 API 配置，请检查启用状态、密钥、模型及地址；可正常游戏。');
   const credential=await db.apiCredentials.get(config.id);if(!credential?.apiKey)throw new InterventionError('当前 API 配置缺少密钥，可正常游戏。');
   let worldContext='';const worldId=snapshot.settings.instructionWorldId;
   if(worldId){const world=await db.worlds.get(worldId),profile=await db.worldProfiles.where('[worldId+characterId]').equals([worldId,id]).first();if(!world||!profile)throw new InterventionError('此角色未关联所选世界，未发起请求。');worldContext=JSON.stringify({name:world.name,background:world.background??'',rules:world.rules??'',setting:profile.setting});}
   const pool=await generateInterventions({settings:snapshot.settings,character,worldContext,config,key:credential.apiKey,signal:controller.signal});
   if(controller.signal.aborted||!current.current.settings.aiIntervention||interventionScope(current.current.settings)!==pool.scope)throw new InterventionError('设置已改变，本次事件未写入。');
   const updated={...current.current,interventionPool:pool};savePhaseData(db.name,updated);current.current=updated;setData(updated);
  }catch(e){setInterventionError(e instanceof InterventionError?e.message:'事件准备未完成，请检查配置或本地存储；可正常游戏。');}
  finally{interventionController.current=null;setInterventionGenerating(false);}
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
 async function importWordInstructions(file:File,target:'character'|TalkMode){
  if(wordImporting||generating)return;
  const snapshot=current.current,settings=snapshot.settings;
  if(target==='character'&&!settings.instructionCharacterId){setError('请先选择要导入的角色。');return;}
  setWordImporting(true);setWordProgress({stage:'reading',processed:0,total:0});setError('');setWordPreview(null);
  try{
   const imported=await readPhaseInstructionWord(file,setWordProgress);
   if(current.current!==snapshot)throw Error('读取期间设置已改变，请重新上传。');
   const targetRows=target==='character'?scopePrompts(settings,selectedScope(settings)):defaultRows(target);
   const known=new Set(targetRows.map(x=>normalizedInstruction(x.text)));
   const additions=imported.filter(x=>{const key=normalizedInstruction(x.text);if(known.has(key))return false;known.add(key);return true;});
   if(!additions.length){setNotice('文档中的指令均已存在，没有重复导入。');return;}
   if(targetRows.length+additions.length>1000)throw Error('导入后超过1000条上限，原词库未改变。');
   setWordPreview({target,items:additions,snapshot});
  }catch(e){setError(e instanceof Error?e.message:'Word 读取失败，原词库未改变。');}
  finally{setWordImporting(false);setWordProgress(null);}
 }
 function saveWordPreview(){
  const preview=wordPreview;if(!preview)return;
  if(current.current!==preview.snapshot){setError('词库或设置已改变，请重新上传 Word。');setWordPreview(null);return;}
  const {target,snapshot}=preview,settings=snapshot.settings;
  const targetRows=target==='character'?scopePrompts(settings,selectedScope(settings)):defaultRows(target);
  if(targetRows.length+preview.items.length>1000){setError('导入数量超过1000条上限。');return;}
  const prefix=target==='character'?selectedScope(settings):'custom:'+target+':import:';
  const rows=preview.items.map(x=>({id:prefix+crypto.randomUUID(),phase:x.phase as Phase,text:x.text}));
  try{
   if(target==='character'){
    const updated=replaceLibrary(snapshot,selectedScope(settings),[...targetRows,...rows],versions);
    savePhaseData(db.name,updated);current.current=updated;setData(updated);
   }else{
    const updated={...snapshot,settings:{...settings,defaultTalkOverrides:{...settings.defaultTalkOverrides,[target]:[...targetRows,...rows]}}};
    if(!validData(updated))throw Error('导入内容不符合词库规则。');
    savePhaseData(db.name,updated);current.current=updated;setData(updated);
   }
   setWordPreview(null);setError('');setNotice('已追加 '+rows.length+' 条分类指令，原词库保留。');
  }catch(e){setError(e instanceof Error?e.message:'保存失败，原词库未改变。');}
 }
 function defaultRows(mode:TalkMode){return s.defaultTalkOverrides?.[mode]??talkInstructions(mode).map(x=>({id:'custom:'+mode+':'+x.id,phase:x.phase,text:x.text}));}
 function updateDefaultRows(mode:TalkMode,rows:PhaseSettings['prompts']){const d=current.current;const settings={...d.settings,defaultTalkOverrides:{...d.settings.defaultTalkOverrides,[mode]:rows}};const session=talkMode(settings)===mode&&d.session.status==='paused'?reroll(settings,d.session):d.session;if(change({...d,settings,session})){setDefaultEditing(null);setError('');setNotice('默认卡片已保存，游戏会使用修改后的指令。');}}
 function saveDefaultEdit(){const e=defaultEditing;if(!e)return;const value=e.text;if(!value.trim()||value.length>1000){setError('请输入1至1000字的指令。');return;}const rows=defaultRows(e.mode),id=e.id??'custom:'+e.mode+':'+crypto.randomUUID();const updated=[...rows.filter(x=>x.id!==e.id),{id,phase:e.phase,text:value}];if(updated.length>1000){setError('每张卡片最多1000条。');return;}if(rows.some(x=>x.id!==e.id&&normalizedInstruction(x.text)===normalizedInstruction(value))&&!rows.some(x=>x.id===e.id&&x.text===value)){setError('卡片中存在重复指令。');return;}updateDefaultRows(e.mode,updated);}
 function removeDefault(mode:TalkMode,id:string){if(!confirm('删除这条默认指令？可通过恢复出厂找回原始内容。'))return;updateDefaultRows(mode,defaultRows(mode).filter(x=>x.id!==id));}
 function resetDefault(mode:TalkMode){if(!confirm('恢复 '+(mode==='sweet'?'Sweet Talk':'Dirty Talk')+' 的全部出厂指令？此卡片的修改将被覆盖，另一张卡片不受影响。'))return;const d=current.current,overrides={...d.settings.defaultTalkOverrides};delete overrides[mode];const settings={...d.settings,defaultTalkOverrides:overrides};const session=talkMode(settings)===mode&&d.session.status==='paused'?reroll(settings,d.session):d.session;if(change({...d,settings,session})){setDefaultEditing(null);setNotice('已恢复该卡片的出厂指令。');setError('');}}
 function savePrompt(){
  if(!text.trim())return setError('请输入提示文本。');
  if(s.instructionMode==='character'&&!s.instructionCharacterId)return setError('请先选择角色。');
  if(!editId&&scopePrompts(s).length>=1000)return setError('每个角色与世界组合最多保存1000条提示。');
  const item={id:editId??(s.instructionMode==='character'?scopePrefix+crypto.randomUUID():crypto.randomUUID()),phase:scope,text:text.trim()};
  const items=scopePrompts(s).filter(p=>p.id!==editId);if(items.some(p=>normalizedInstruction(p.text)===normalizedInstruction(item.text)))return setError('此组合已存在相同提示。');const updated=replaceLibrary(current.current,selectedScope(s),[...items,item],versions);
  try{savePhaseData(db.name,updated);current.current=updated;setData(updated);setError('');setEditId(null);setText('');setNotice('指令已保存。');}catch(e){setError(e instanceof Error?e.message:'保存失败，编辑内容仍保留。');}
 }
 return <section ref={anchor} className="phase-play" aria-label="忍一下嘛应用" data-screen={screen} data-beat={pulse} style={{"--phase-beat-duration":Math.min(300,60000/bpmAt(s,r.elapsedMs??0,r.bpmOffset??0)*.4)+"ms"} as CSSProperties}>
 <header className="phase-play-heading"><div><h2>忍一下嘛</h2><p>{screen==='settings'?'选择玩法与节奏，再开启一场游戏':'跟随灯光与指令，按自己的节奏来'}</p></div><button onClick={screen==='running'?backToSettings:exit}>{screen==='running'?'返回设置':'退出应用'}</button></header>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {blocked&&<button onClick={()=>{if(!confirm('只重置忍一下嘛的本地记录，其他数据不变。继续吗？'))return;const settings=defaults(),value:PhaseData={version:1,settings,session:initial(settings)};if(persist(value)){current.current=value;setData(value);setBlocked(false);setError('');}}}>重置本应用记录</button>}
 {screen==='settings'?<>
  <nav className="phase-play-tabs" aria-label="设置分类">{(['玩法','节奏','指令','其他'] as const).map(name=><button key={name} aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}>{name}</button>)}</nav>
  <fieldset disabled={running||blocked} className="phase-play-settings">
  {tab==='玩法'&&<div className="phase-play-card"><h3>游戏方式</h3><label>整局时长<select aria-label="整局时长" value={s.gameMinutes??10} onChange={e=>{const gameMinutes=Number(e.target.value);const d=current.current,settings={...d.settings,gameMinutes};change({...d,settings,session:initial(settings)});}}>{[5,10,15,20,50].map(n=><option key={n} value={n}>{n} 分钟</option>)}</select></label><p className="phase-play-note">整局倒计时结束后自动停止。词库不够时允许重复，不阻止开始游戏。</p><p className="phase-play-note">红灯停止、黄灯放慢、绿灯继续。切换顺序可自行选择。</p><label>切换方式<select aria-label="切换方式" value={s.mode} onChange={e=>setting({mode:e.target.value as PhaseSettings['mode']})}><option value="sequence">顺序切换</option><option value="random">随机切换</option></select></label><label className="phase-play-toggle">随机阶段时长<input type="checkbox" aria-label="随机阶段时长" checked={s.randomDuration} onChange={e=>setting({randomDuration:e.target.checked})}/></label></div>}
  {tab==='其他'&&<ChatLinkSettings/>}
  {tab==='玩法'&&<div className="phase-play-tone-settings">
 <label className="phase-play-tone-card"><span><strong>Sweet Talk</strong><small>温柔鼓励、亲昵称呼，语气更柔和</small></span><input type="checkbox" aria-label="Sweet Talk" checked={!!s.sweetMode} onChange={e=>setting({sweetMode:e.target.checked,commandMode:e.target.checked?false:s.commandMode})}/></label>
 <label className="phase-play-tone-card"><span><strong>Dirty Talk</strong><small>简短直接、有主导感，但随时可以暂停</small></span><input type="checkbox" aria-label="Dirty Talk" checked={!!s.commandMode} onChange={e=>setting({commandMode:e.target.checked,sweetMode:e.target.checked?false:s.sweetMode})}/></label>
 <div className="phase-play-card"><label>对方的称呼<input aria-label="对方的称呼" maxLength={30} value={s.address??''} placeholder="选填" onChange={e=>setting({address:e.target.value})}/></label><label>语气强度<select aria-label="语气强度" value={s.intensity??'medium'} onChange={e=>setting({intensity:e.target.value as NonNullable<PhaseSettings['intensity']>})}><option value="soft">微辣 · 温柔</option><option value="medium">中辣 · 明确</option><option value="strong">特辣 · 冷静直接</option><option value="dramatic">戏剧化 · 强烈氛围</option></select></label><p className="phase-play-note">强度只调整文案风格，不改变灯光时间或暂停权限。</p></div>
 </div>}
 {tab==='节奏'&&<div className="phase-play-card"><h3>灯光节奏</h3><p className="phase-play-note">默认红灯最短。调整每种灯光的持续时间。</p>
  {(['green','yellow','red'] as const).map(p=><div className="phase-play-duration" data-color={p} key={p}><strong>{phaseNames[p]}</strong>{(s.randomDuration?['min','max']:['seconds']).map(k=><label key={k}>{k==='min'?'最短':k==='max'?'最长':'时长'}<input aria-label={phaseNames[p]+(k==='min'?'最短秒数':k==='max'?'最长秒数':'秒数')} type="number" min={1} max={600} step={1} defaultValue={s.duration[p][k as 'seconds'|'min'|'max']} key={p+":"+k+":"+s.duration[p][k as 'seconds'|'min'|'max']} onBlur={e=>{const value=e.currentTarget.value.trim();if(!value||!Number.isInteger(Number(value))||Number(value)<1||Number(value)>600){e.currentTarget.value=String(current.current.settings.duration[p][k as "seconds"|"min"|"max"]);setError("请输入1～600之间的整数秒数。");return;}setting({duration:{...current.current.settings.duration,[p]:{...current.current.settings.duration[p],[k]:Number(value)}}});e.currentTarget.value=String(current.current.settings.duration[p][k as "seconds"|"min"|"max"]);}} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/></label>)}</div>)}
  <label>节拍速度 · {s.bpm} BPM<input aria-label="节拍速度" type="range" min={30} max={180} step={1} value={s.bpm} onChange={e=>setting({bpm:Number(e.target.value)})}/></label><label className="phase-play-toggle">自动加速节拍<input type="checkbox" aria-label="自动加速节拍" checked={!!s.autoAccelerate} onChange={e=>setting({autoAccelerate:e.target.checked})}/></label>{s.autoAccelerate&&<><label>加速目标 · {s.maxBpm??120} BPM<input aria-label="加速目标BPM" type="range" min={s.bpm} max={180} value={Math.max(s.bpm,s.maxBpm??120)} onChange={e=>setting({maxBpm:Number(e.target.value)})}/></label><label>加速所需秒数<input aria-label="加速所需秒数" type="number" min={10} max={3600} value={s.accelerationSeconds??120} onChange={e=>setting({accelerationSeconds:Number(e.target.value)})}/></label></>}<p className="phase-play-note">自动加速只影响节拍声和灯光脉冲，不改变红黄绿阶段持续时间。</p></div>}
  {tab==='指令'&&<div className="phase-play-card"><h3>指令来源</h3>
 <div className="phase-play-mode-options"><label><input type="radio" name="phase-instruction-mode" checked={(s.instructionMode??'default')==='default'} onChange={()=>setting({instructionMode:'default'})}/> 默认指令</label><label><input type="radio" name="phase-instruction-mode" checked={s.instructionMode==='character'} onChange={()=>setting({instructionMode:'character'})}/> 根据角色生成指令</label></div>
 {s.instructionMode!=='character'&&<section aria-label="默认分组" className="phase-play-default-groups"><h4>默认分组 · 可编辑</h4>{(['sweet','dirty'] as const).map(mode=><div key={mode} className="phase-play-default-card"><div className="phase-play-default-card-header"><button type="button" aria-pressed={talkMode(s)===mode} onClick={()=>setting({sweetMode:mode==='sweet'&&talkMode(s)!==mode,commandMode:mode==='dirty'&&talkMode(s)!==mode})}>{mode==='sweet'?'Sweet Talk':'Dirty Talk'}</button><small>{s.defaultTalkOverrides?.[mode]?'已自定义':'出厂默认'}</small></div><small>{phases.map(p=>phaseNames[p]+' '+defaultRows(mode).filter(x=>x.phase===p).length+'条').join(' · ')}</small><label className="phase-play-word-upload">上传 Word 指令（.docx）<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={wordImporting||generating} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void importWordInstructions(file,mode);}}/></label><details className="phase-play-default-details"><summary>管理指令（{defaultRows(mode).length}）</summary><div className="phase-play-default-toolbar"><button type="button" onClick={()=>setDefaultEditing({mode,id:null,phase:'green',text:''})}>＋ 新增指令</button><button type="button" onClick={()=>resetDefault(mode)}>恢复出厂</button></div>{defaultEditing?.mode===mode&&<div className="phase-play-default-editor"><label>所属灯色<select value={defaultEditing.phase} onChange={e=>setDefaultEditing({...defaultEditing,phase:e.target.value as Phase})}>{phases.map(p=><option key={p} value={p}>{phaseNames[p]}</option>)}</select></label><label>指令内容<textarea maxLength={1000} value={defaultEditing.text} onChange={e=>setDefaultEditing({...defaultEditing,text:e.target.value})}/></label><div className="phase-play-actions"><button type="button" onClick={saveDefaultEdit}>保存指令</button><button type="button" onClick={()=>setDefaultEditing(null)}>取消</button></div></div>}<div className="phase-play-default-list">{defaultRows(mode).map(item=><div className="phase-play-default-item" key={item.id}><small>{phaseNames[item.phase as Phase]}</small><p>{item.text}</p><div className="phase-play-actions"><button type="button" onClick={()=>setDefaultEditing({mode,id:item.id,phase:item.phase as Phase,text:item.text})}>编辑</button><button type="button" onClick={()=>removeDefault(mode,item.id)}>删除</button></div></div>)}</div></details></div>)}</section>}
 {s.instructionMode==='character'&&<div className="phase-play-character-settings"><label>选择角色<select aria-label="指令角色" value={s.instructionCharacterId??''} onChange={e=>{setEditId(null);setText('');setting({instructionCharacterId:e.target.value});}}><option value="">请选择角色</option>{characters.map(character=><option key={character.id} value={character.id}>{character.name}</option>)}</select></label><label>世界设定（可选）<select aria-label="指令世界" value={s.instructionWorldId??''} onChange={e=>{setEditId(null);setText('');setting({instructionWorldId:e.target.value});}}><option value="">仅角色基础人设</option>{worldOptions.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>成人内容尺度<select aria-label="成人内容尺度" value={s.contentLevel??"medium"} onChange={e=>setting({contentLevel:e.target.value as NonNullable<PhaseSettings["contentLevel"]>})}><option value="light">轻度</option><option value="medium">中度</option><option value="high">高度</option></select></label><p className="phase-play-note">此项是生成表达偏好，实际输出取决于模型服务商的内容政策。</p><p className="phase-play-note">每次生成30条角色专属台词（红黄绿各10条）；按当前输出上限分批调用，会消耗 API 额度，游戏中按阶段随机抽取。可编辑、删除、新增或重新生成；更新时保留旧版本（受本地容量限制），不写入聊天记忆。</p>{generationError&&<div role="alert" className="phase-play-generation-error"><strong>AI 生成失败</strong><p>{generationError}</p><small>可能原因包括服务商内容审核、模型输出被截断、网络或超时、JSON 格式或重复指令。仅当服务商明确返回审核信息时才能确认审核拦截；原词库保持不变。</small></div>}<button type="button" disabled={generating||!s.instructionCharacterId} onClick={()=>void generateCharacterLibrary()}>{generating?progress||'正在生成…':'AI 追加30条指令'}</button><button type="button" disabled={generating||!s.instructionCharacterId} onClick={()=>void generateCharacterLibrary(true)}>重新生成30条指令</button>{generating&&<button type="button" onClick={()=>generationController.current?.abort()}>取消生成</button>}<button type="button" disabled={generating||!s.instructionCharacterId} onClick={makeCharacterDraft}>建立基础草稿（不调用 AI）</button><label className="phase-play-word-upload">上传 Word 指令（.docx）<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={wordImporting||generating} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void importWordInstructions(file,'character');}}/></label><button type="button" onClick={()=>setShowInstructionCards(v=>!v)}>{showInstructionCards?'收起角色指令卡片':'查看角色指令卡片'}</button>{versions.length>0&&<details key={scopePrefix} className="phase-play-history"><summary>历史版本（{versions.length}）</summary><div className="phase-play-versions">{versions.slice().reverse().map((version,i)=><div key={version.savedAt+'-'+i} className="phase-play-version"><small>{new Date(version.savedAt).toLocaleString('zh-CN')} · {version.prompts.length} 条</small><button type="button" onClick={()=>{if(!confirm('恢复此版本将替换当前角色指令，其他角色不变。确定吗？'))return;const restored=replaceLibrary(current.current,scopePrefix,version.prompts,versions);if(!validData(restored)){setError('历史版本数据无效，未恢复。');return;}try{savePhaseData(db.name,restored);current.current=restored;setData(restored);setError('');setNotice('已恢复选定的历史版本。');}catch(e){setError(e instanceof Error?e.message:'恢复失败。');}}}>恢复此版本</button></div>)}</div></details>}</div>}
 {wordImporting&&<div role="status" aria-live="polite" className="phase-play-word-progress"><strong>{wordProgress?.stage==='reading'?'正在读取 Word 文档…':wordProgress?.stage==='classifying'?'正在本地分类指令…':'分类完成，正在准备预览…'}</strong><p>{wordProgress?.stage==='classifying'?'已检查 '+wordProgress.processed+' / '+wordProgress.total+' 段文字':'无需 API，不会消耗模型额度。'}</p>{wordProgress?.stage==='classifying'&&<progress max={Math.max(1,wordProgress.total)} value={wordProgress.processed}/>}</div>}
 {wordPreview&&<section className="phase-play-card" aria-label="Word 指令分类预览"><h4>Word 导入预览 · {wordPreview.items.length} 条</h4><div className="phase-play-word-summary">{phases.map(p=><div key={p}><strong>{phaseNames[p]}</strong><span>{wordPreview.items.filter(x=>x.phase===p).length} 条</span></div>)}</div><p className="phase-play-note">按文档红黄绿标题分组；未识别到标题的指令默认归入绿灯。可以直接导入，手动调整完全可选。</p><details className="phase-play-word-details"><summary>查看分类明细（可选调整）</summary><div className="phase-play-default-list">{wordPreview.items.map((item,i)=><div className="phase-play-default-item" key={i}><p>{i+1}. {item.text}</p><label>灯色<select aria-label={'第'+(i+1)+'条灯色'} value={item.phase} onChange={e=>setWordPreview(old=>old?{...old,items:old.items.map((row,j)=>j===i?{...row,phase:e.target.value as Phase}:row)}:null)}>{phases.map(p=><option key={p} value={p}>{phaseNames[p]}</option>)}</select></label></div>)}</div></details><div className="phase-play-actions"><button type="button" onClick={saveWordPreview}>确认导入 {wordPreview.items.length} 条</button><button type="button" onClick={()=>{setWordPreview(null);setError('');}}>取消</button></div></section>}
 <p className="phase-play-note">默认指令自动从内置库抽取；角色模式使用选定角色已保存的指令。下方可以编辑指令。</p><label>适用阶段<select aria-label="提示适用阶段" value={scope} onChange={e=>setScope(e.target.value as Phase|'all')}><option value="all">所有阶段</option>{phases.map(p=><option key={p} value={p}>{phaseNames[p]}</option>)}</select></label><label>附加提示<textarea aria-label="提示文本" maxLength={1000} value={text} onChange={e=>setText(e.target.value)} placeholder="选填：增加自己的提示"/></label><div className="phase-play-actions"><button disabled={!text.trim()} onClick={savePrompt}>{editId?'保存修改':'添加提示'}</button>{editId&&<button onClick={()=>{setEditId(null);setText('');}}>取消编辑</button>}</div>{(s.instructionMode!=='character'||showInstructionCards)&&<ul aria-label={s.instructionMode==='character'?'角色指令卡片':'已保存指令'}>{s.prompts.filter(p=>s.instructionMode==='character'?p.id.startsWith(scopePrefix):!p.id.startsWith('character:')).map(p=><li key={p.id}><small>{p.phase==='all'?'所有阶段':phaseNames[p.phase]}</small><p>{p.text}</p><div className="phase-play-actions"><button onClick={()=>{setEditId(p.id);setText(p.text);setScope(p.phase);}}>编辑提示</button><button onClick={()=>{const updated=replaceLibrary(current.current,selectedScope(s),scopePrompts(s).filter(x=>x.id!==p.id),versions);try{savePhaseData(db.name,updated);current.current=updated;setData(updated);setError('');if(editId===p.id){setEditId(null);setText('');}setNotice('指令已删除。');}catch(e){setError(e instanceof Error?e.message:'删除失败。');}}}>删除提示</button></div></li>)}</ul>}</div>}
  {tab==='其他'&&<div className="phase-play-card"><h3>声音与反馈</h3><label className="phase-play-toggle">节拍反馈<input type="checkbox" checked={s.beat} onChange={e=>setting({beat:e.target.checked})}/></label><label className="phase-play-toggle">音效<input type="checkbox" aria-label="音效" checked={s.sound} onChange={e=>{setting({sound:e.target.checked});if(e.target.checked)void feedback.current!.unlock().then(ok=>{if(!ok)setNotice('音频不可用，计时仍可正常使用。');});else feedback.current?.stop();}}/></label><label>音量 · {Math.round(s.volume*100)}%<input aria-label="音量" type="range" min={0} max={100} step={5} value={Math.round(s.volume*100)} onChange={e=>setting({volume:Number(e.target.value)/100})}/></label><label className="phase-play-toggle">震动反馈<input type="checkbox" checked={s.vibration} onChange={e=>setting({vibration:e.target.checked})}/></label><p className="phase-play-note">{typeof navigator.vibrate==='function'?'设备提供震动接口，实际效果取决于浏览器。':'此浏览器未提供震动接口，将只使用可用的声音与视觉反馈。'}</p></div>}
  {tab==='其他'&&<PhaseMp3Upload source={audioSource} onSourceChange={value=>{setAudioSource(value);audioSourceRef.current=value;localStorage.setItem('claudia.phasePlay.audioSource:'+db.name,value);stopPhaseMp3();}}/>}
  {tab==='其他'&&<div className="phase-play-card"><h3>AI 临场干预</h3><label className="phase-play-toggle">AI 临场干预<input aria-label="AI 临场干预" type="checkbox" checked={!!s.aiIntervention} onChange={e=>setting({aiIntervention:e.target.checked})}/></label><p className="phase-play-note">角色可能在游戏过程中突然改变节奏或阶段安排。</p><p className="phase-play-note">默认关闭。开启后角色可在预设范围内自动改变参数；仅点击下方准备按钮会消耗 API 额度（每次 1 次请求，不自动重试）。开局与游戏中不请求 API；没有事件也可直接开始。取消已发出的请求仍可能被服务商计费。</p>{s.aiIntervention&&<><label>干预角色<select aria-label="干预角色" value={s.instructionCharacterId??''} onChange={e=>setting({instructionCharacterId:e.target.value})}><option value="">请选择角色</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>干预世界（可选）<select aria-label="干预世界" value={s.instructionWorldId??''} onChange={e=>setting({instructionWorldId:e.target.value})}><option value="">仅基础人设</option>{worldOptions.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><p className="phase-play-note">{data.interventionPool?.scope===interventionScope(s)?`已准备 ${data.interventionPool.events.length} 条事件，可供新一局复用；再次准备会额外请求。`:'当前角色、世界及模式尚未准备事件。'} 本局最多两次，暂停与退出始终优先。</p><button type="button" disabled={interventionGenerating||!s.instructionCharacterId} onClick={()=>void prepareEvents()}>{interventionGenerating?'正在准备事件…':'准备新一局事件（1次 API 请求）'}</button>{interventionGenerating&&<button type="button" onClick={()=>interventionController.current?.abort()}>取消事件准备</button>}{interventionError&&<p role="alert">{interventionError}</p>}</>}</div>}
  </fieldset>
  <button className="phase-play-primary phase-play-start" disabled={blocked||running||generating} onClick={()=>void enter()}>我准备好了 · 开始</button>
  {r.status==='paused'&&<button className="phase-play-resume" onClick={()=>setScreen('running')}>查看上次暂停的游戏</button>}
  <p className="phase-play-note">设置保存在当前浏览器。切换后台或锁屏后会暂停；角色聊天联动设置纳入 ZIP 备份；游戏词库与计时存档仍为本机保存。</p>
 </>:<>
  <div className="phase-play-stage" data-phase={r.phase}>
    <span className="phase-play-orb" aria-hidden="true"><span key={pulse} className="phase-play-orb-pulse" data-active={pulse>0&&pulsePhase===r.phase&&running&&s.beat&&r.phase!=='red'}/></span>
    <span className="phase-play-stage-label">{phaseNames[r.phase]} · {running?'进行中':r.status==='paused'?'已暂停':r.status==='finished'?'本局结束':'准备中'}</span>
  </div>
  <div className="phase-play-instruction">
    <span className="phase-play-instruction-tag">我陪着你，这样来</span>
    <p className="phase-play-prompt">{(r.prompt||'准备好后，点击开始。').replace(/^\s*(?:[（(]?\d+[）).、．]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, '')}</p>
    <button type="button" className="phase-play-reroll" disabled={blocked||r.status==='idle'||r.status==='finished'} onClick={()=>change({...current.current,session:reroll(current.current.settings,current.current.session)})}>换一条</button>
    <div className="phase-play-instruction-footer">跟着节拍来，随时可以暂停。</div>
  </div>
  <div className="phase-play-timer"><output aria-label="阶段剩余时间">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</output><small>第 {r.step} 阶段 · <span aria-label="当前BPM">{Math.round(bpmAt(s,r.elapsedMs??0,r.bpmOffset??0))} BPM</span> · 本局剩余 <span aria-label="整局剩余时间">{String(Math.floor(gameSeconds/60)).padStart(2,'0')}:{String(gameSeconds%60).padStart(2,'0')}</span></small></div>
  <div className="phase-play-tempo-buttons"><button type="button" disabled={blocked} onClick={()=>setting({bpm:Math.max(30,Math.round(bpmAt(s,r.elapsedMs??0,r.bpmOffset??0))-10),autoAccelerate:false})}>慢</button><button type="button" disabled={blocked} onClick={()=>setting({bpm:Math.min(180,Math.round(bpmAt(s,r.elapsedMs??0,r.bpmOffset??0))+10),autoAccelerate:false})}>快</button></div>
  <button type="button" className="phase-play-emergency" disabled={blocked} onClick={()=>{pause('已立即暂停。');}}>不行了，让我停一下</button>
  <div className="phase-play-stats"><div><small>已完成阶段</small><strong>{Math.max(0,r.step-1)}</strong></div><div><small>当前状态</small><strong>{running?'进行中':r.status==='paused'?'已暂停':r.status==='finished'?'本局结束':'待开始'}</strong></div><div><small>已用时</small><strong>{String(Math.floor((r.elapsedMs??0)/60000)).padStart(2,'0')}:{String(Math.floor(((r.elapsedMs??0)%60000)/1000)).padStart(2,'0')}</strong></div></div>
  <div className="phase-play-actions phase-play-main-actions"><button disabled={blocked} onClick={()=>running?pause():void run()}>{running?'暂停':r.status==='idle'||r.status==='finished'?'开始新一局':'继续'}</button><button disabled={blocked||r.status==='idle'||r.status==='finished'} onClick={()=>{setPulse(0);feedback.current?.silence();change({...current.current,session:next(s,current.current.session)});}}>下一阶段</button></div>
  <div className="phase-play-sound"><label>音量 {Math.round(s.volume*100)}% <input aria-label="游戏中音量" type="range" min="0" max="100" step="5" value={Math.round(s.volume*100)} onChange={e=>setting({volume:Number(e.target.value)/100})}/></label><button type="button" disabled={blocked} onClick={()=>{setting({sound:!s.sound});if(!s.sound)void feedback.current?.unlock();else feedback.current?.silence();}}>音效{s.sound?'开':'关'}</button></div>
  <div className="phase-play-actions phase-play-secondary-actions"><button disabled={blocked} onClick={()=>{pause();change({...current.current,session:initial(s)});}}>重置计时</button><button onClick={exit}>快速退出</button></div>
 </>}
 {screen==='running'&&running&&interventionNotice&&<InterventionToast key={interventionNotice.id} notice={interventionNotice} anchor={anchor} onDone={clearInterventionNotice}/>}
 </section>;
}
