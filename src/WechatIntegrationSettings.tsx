import {authorizeQqAi,disableQqAi,deleteQqAi,getQqAiStatus,syncQqContext,deleteQqContext} from './qqAiAuthorization';
import {buildContext} from './chatContext';
import {restoreWechatFromBackupZip} from './backupZip';
import React,{useEffect,useState} from 'react';
import './wechatIntegration.css';
import {WechatQrCode} from './WechatQrCode';
import {syncWechatEffectiveContext,deleteWechatEffectiveContext} from './wechatContextSync';
import {getWechatClosedContinuity,setWechatClosedContinuity,reconcileWechatAfterReopen} from './wechatClosedContinuity';
import {setQqClosedContinuity,reconcileQqAfterReopen} from './qqClosedContinuity';
import {authorizeWechatAi,disableWechatAi,deleteWechatAi,getWechatAiStatus} from './wechatAiAuthorization';
import {db} from './store';
import {startWechatLogin,pollWechatLogin} from './wechatQrLogin';
import {startQqQr,pollQqQr,listQqCloudBindings,disconnectQqCloudBinding,type QqQrSession} from './qqQrLogin';
import {listWechatCloudBindings} from './wechatCloudIdentity';
import {syncWechatDailyConversation} from './wechatDailySync';
import {clearWechatCloudConfig,readWechatCloudConfig,saveWechatCloudConfig} from './wechatCloudConfig';
import {checkCloudReadiness,type CloudCheck} from './cloudReadiness';

/** Accept an API base URL or a full OpenAI-compatible chat-completions URL. */
function qqChatEndpoint(input:string):string{
 const raw=input.trim();
 let url:URL;
 try{url=new URL(raw);}catch{throw Error('API 地址无效，请检查本地 API 配置');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)
  throw Error('QQ 云端 API 必须使用不含查询参数的 HTTPS 地址');
 const path=url.pathname.replace(/\/+$/,'');
 if(!path.endsWith('/chat/completions'))
  url.pathname=path+'/chat/completions';
 return url.toString();
}
/** WeChat-only opt-in configuration; no cross-user shared project. */
export function WechatIntegrationSettings(){
 const initial=readWechatCloudConfig();
 const [section,setSection]=useState<'cloud'|'account'|'qq'|null>(null);
 const [url,setUrl]=useState(initial?.url??'');
 const [key,setKey]=useState(initial?.publishableKey??'');
 const [configured,setConfigured]=useState(!!initial);
 const [cloudChecking,setCloudChecking]=useState(false);
 const [cloudChecks,setCloudChecks]=useState<CloudCheck[]|null>(null);
 const [notice,setNotice]=useState('');
 const [bindings,setBindings]=useState<Array<{id:string;character_id:string;conversation_id:string;status:string}>|null>(null);
 const [loading,setLoading]=useState(false);
 const [daily,setDaily]=useState<Array<{id:string;characterId:string;characterName:string}>>([]);
 const [target,setTarget]=useState('');
 const [qr,setQr]=useState<{attemptId:string;qrContent:string;expiresAt:string}|null>(null);
 const [qrStatus,setQrStatus]=useState('未开始');
 const [qqSession,setQqSession]=useState<QqQrSession|null>(null);
 const [qqBusy,setQqBusy]=useState(false);
 const [qqTarget,setQqTarget]=useState('');
 const [qqBindings,setQqBindings]=useState<Array<{id:string;character_id:string;conversation_id:string;status:string}>>([]);
 const [qqBindingLoadState,setQqBindingLoadState]=useState<'idle'|'loading'|'loaded'|'error'>('idle');
 const loadQq=async()=>{setQqBindingLoadState('loading');setQqNotice('');try{const rows=await listQqCloudBindings();setQqBindings(rows);setQqBindingLoadState('loaded');}catch(e){setQqBindingLoadState('error');setQqNotice((e instanceof Error?e.message:'QQ 绑定查询失败')+'；无法确认绑定状态，请勿重新扫码。');}};
 useEffect(()=>{if(section==='qq'){void loadQq();void Promise.all([db.conversations.toArray(),db.characters.toArray()]).then(([rows,chars])=>{const names=new Map(chars.map(c=>[c.id,c.name]));const list=rows.filter(c=>c.mode==='daily'&&!c.worldId).map(c=>({id:c.id,characterId:c.characterId,characterName:names.get(c.characterId)||'未命名角色'}));setDaily(list);setQqTarget(current=>list.some(c=>c.id===current)?current:list[0]?.id||'');}).catch(()=>setQqNotice('读取日常角色失败'));}},[section]);
 // Existing QQ authorization predates the foreground-sync opt-in flag.
 // Query only while the owner opens QQ settings; never authorize a new key.
 useEffect(()=>{
  if(section!=='qq'||!qqBindings.length)return;
  let alive=true;
  void Promise.all(qqBindings.filter(b=>b.status==='connected').map(async b=>{
   try{const status=await getQqAiStatus(b.id);
    if(alive&&status.enabled){setQqClosedContinuity(b.id,true);void reconcileQqAfterReopen().catch(()=>{});}
   }catch{/* Offline status can be checked again later. */}
  }));
  return()=>{alive=false;};
 },[section,qqBindings]);
 const [qqAiBinding,setQqAiBinding]=useState('');
 const [qqAiStatus,setQqAiStatus]=useState('');
 const [qqApiId,setQqApiId]=useState('');
 const [qqAiModel,setQqAiModel]=useState('');
 const [qqAiEndpoint,setQqAiEndpoint]=useState('');
 const [qqAiKey,setQqAiKey]=useState('');
 const [qqAiBusy,setQqAiBusy]=useState(false);
 // Restore the selected binding's actual cloud authorization on every visit.
 // This is read-only: never re-upload credentials or repeat authorization.
 useEffect(()=>{
  if(section!=='qq'||!qqAiBinding){setQqAiStatus('');return;}
  let active=true;
  setQqAiStatus('正在查询云端授权状态…');
  void getQqAiStatus(qqAiBinding).then(status=>{
   if(active)setQqAiStatus(status.enabled?'已授权并启用':status.configured?'已配置但停用':'尚未授权');
  }).catch(()=>{
   if(active)setQqAiStatus('授权状态查询失败，请检查网络后点击查询授权状态');
  });
  return()=>{active=false;};
 },[section,qqAiBinding]);
 const [qqContextStatus,setQqContextStatus]=useState('');
 const [qqApis,setQqApis]=useState<Array<{id:string;name:string;model:string;enabled:boolean}>>([]);
 useEffect(()=>{if(section!=='qq')return;void db.apiConfigs.toArray().then(rows=>setQqApis(rows.filter(x=>x.enabled).map(x=>({id:x.id,name:x.name,model:x.model,enabled:x.enabled})))).catch(()=>setQqNotice('本地 API 列表读取失败'));},[section]);
 useEffect(()=>{if(!qqBindings.some(b=>b.id===qqAiBinding&&b.status==='connected'))setQqAiBinding(qqBindings.find(b=>b.status==='connected')?.id||'');},[qqBindings,qqAiBinding]);
 const qqSync=async(binding:{id:string;conversation_id:string})=>{
  const conversation=await db.conversations.get(binding.conversation_id);
  if(!conversation||conversation.mode!=='daily'||conversation.worldId)throw Error('仅支持已绑定的日常聊天');
  const context=await buildContext(conversation);
  if(context.some(m=>m.images?.length))throw Error('当前有效上下文包含图片，QQ 云端文字模型无法完整还原');
  const messages=context.map(m=>({role:m.role,content:m.content}));
  if(!messages.some(m=>m.role==='system')||messages.length>64||JSON.stringify(messages).length>80000)
   throw Error('QQ 角色上下文超过云端安全容量或缺少系统设定，已停止同步');
  await syncQqContext(binding.id,messages);
  setQqContextStatus('已同步 '+messages.length+' 段角色有效上下文');
 };
 const qqInheritApi=async()=>{
  const binding=qqBindings.find(b=>b.id===qqAiBinding&&b.status==='connected');
  if(!binding)throw Error('请先选择已连接的 QQ 角色');
  const character=await db.characters.get(binding.character_id);
  const configs=await db.apiConfigs.toArray();
  const config=configs.find(c=>c.id===qqApiId&&c.enabled)||configs.find(c=>c.id===character?.apiConfigId&&c.enabled)||configs.find(c=>c.isDefault&&c.enabled);
  if(!config)throw Error('请先在小手机配置可用 API');
  const credentials=await db.apiCredentials.get(config.id);
  if(!credentials?.apiKey)throw Error('所选 API 没有本地保存的密钥');
  if(!window.confirm('从本机读取「'+config.name+'」的 API 信息填入 QQ 授权表单？此时不会上传密钥。'))return;
  setQqApiId(config.id);setQqAiModel(config.model);
  setQqAiEndpoint(qqChatEndpoint(config.baseUrl));
  setQqAiKey(credentials.apiKey);
  setQqAiStatus('本地 API 已填写。请点击「确认授权 QQ 云端 AI」完成后台授权；这一步不是重新扫码。');
 };
 // One explicit, owner-scoped action: use this character's local API and authorize its QQ binding.
 // QR connection alone never grants cloud access to local credentials.
 const qqAuthorizeLocal=async()=>{
  const binding=qqBindings.find(b=>b.id===qqAiBinding&&b.status==='connected');
  if(!binding||qqAiBusy)return;
  setQqAiBusy(true);setQqNotice('');
  try{
   const existing=await getQqAiStatus(binding.id);
   if(existing.enabled){setQqAiStatus('已授权并启用，无需重复授权或扫码');return;}
   const character=await db.characters.get(binding.character_id);
   const configs=await db.apiConfigs.toArray();
   const config=configs.find(c=>c.id===qqApiId&&c.enabled)||
    configs.find(c=>c.id===character?.apiConfigId&&c.enabled)||
    configs.find(c=>c.isDefault&&c.enabled);
   if(!config)throw Error('此角色没有可用的本地 API 配置');
   const credentials=await db.apiCredentials.get(config.id);
   if(!credentials?.apiKey)throw Error('本地 API Key 不存在，无法授权 QQ 后台');
   const endpoint=qqChatEndpoint(config.baseUrl);
   if(!window.confirm('为当前 QQ 机器人单独授权「'+config.name+'」？将同步该角色有效上下文，并加密保存 API Key 到你自己的 Supabase。不会影响其他 QQ 机器人。'))return;
   await qqSync(binding);
   await authorizeQqAi({bindingId:binding.id,systemPrompt:'严格遵循当前授权同步的角色有效上下文。',
    model:config.model,endpoint,apiKey:credentials.apiKey});
   const verified=await getQqAiStatus(binding.id);
   if(!verified.enabled)throw Error('云端授权尚未生效，请查询授权状态，不要重新扫码');
   setQqClosedContinuity(binding.id,true);
   setQqAiKey('');setQqAiStatus('已授权并启用，无需重新扫码');
   void reconcileQqAfterReopen().catch(()=>{});
  }catch(e){setQqNotice(e instanceof Error?e.message:'QQ 云端授权失败');}
  finally{setQqAiBusy(false);}
 };
 const qqAiAction=async(action:'status'|'authorize'|'disable'|'delete'|'sync'|'delete-context')=>{
  const binding=qqBindings.find(b=>b.id===qqAiBinding&&b.status==='connected');
  if(!binding||qqAiBusy)return;
  setQqAiBusy(true);setQqNotice('');
  try{
   if(action==='status'){
    const status=await getQqAiStatus(binding.id);
    setQqAiStatus(status.enabled?'已授权并启用':status.configured?'已配置但停用':'尚未授权');
    if(status.enabled){setQqClosedContinuity(binding.id,true);void reconcileQqAfterReopen().catch(()=>{});}
   }else if(action==='authorize'){
    if(!window.confirm('将当前角色有效上下文同步到自己的 Supabase，并加密保存所选 API Key，授权 QQ 后台自动回复？'))return;
    await qqSync(binding);
    await authorizeQqAi({bindingId:binding.id,systemPrompt:'严格遵循当前授权同步的角色有效上下文。',
     model:qqAiModel,endpoint:qqChatEndpoint(qqAiEndpoint),apiKey:qqAiKey});
    setQqClosedContinuity(binding.id,true);
    setQqAiKey('');setQqAiStatus('已授权并启用');
    void reconcileQqAfterReopen().catch(()=>{});
   }else if(action==='sync'){
    if(window.confirm('将当前日常聊天有效上下文同步到自己的 QQ 云端？'))await qqSync(binding);
   }else if(action==='delete-context'){
    if(window.confirm('删除这个 QQ 角色的云端上下文？')){await deleteQqContext(binding.id);setQqContextStatus('已删除云端上下文');}
   }else if(action==='disable'){await disableQqAi(binding.id);setQqClosedContinuity(binding.id,false);setQqAiStatus('已停用');}
   else if(window.confirm('删除 QQ 云端 AI 配置和已存储的 API Key？')){
    await deleteQqAi(binding.id);setQqClosedContinuity(binding.id,false);setQqAiStatus('已删除');
   }
  }catch(e){setQqNotice(e instanceof Error?e.message:'QQ AI 操作失败');}
  finally{setQqAiBusy(false);}
 };
 const [qqNotice,setQqNotice]=useState('');
 const beginQq=async()=>{setQqBusy(true);setQqNotice('');setQqSession(null);try{const chosen=daily.find(c=>c.id===qqTarget);if(!chosen)throw Error('请先选择日常角色');setQqSession(await startQqQr(chosen.id,chosen.characterId));}catch(e){setQqNotice(e instanceof Error?e.message:'QQ 二维码获取失败');}finally{setQqBusy(false);}};
 useEffect(()=>{if(section!=='qq'||!qqSession||['failed','expired','storage_not_configured'].includes(qqSession.status))return;let active=true;const timer=window.setInterval(()=>{void pollQqQr(qqSession.attemptId).then(next=>{if(active){setQqSession(next);if(next.status==='connected')void loadQq();}}).catch(e=>{if(active){setQqNotice(e instanceof Error?e.message:'扫码状态查询失败');window.clearInterval(timer);}});},2500);return()=>{active=false;window.clearInterval(timer);};},[section,qqSession?.attemptId,qqSession?.status]);
 const [polling,setPolling]=useState(false);
 const [pollTick,setPollTick]=useState(0);
 const [aiBinding,setAiBinding]=useState('');
 const [aiStatus,setAiStatus]=useState('');
 const [aiModel,setAiModel]=useState('');
 const [savedApis,setSavedApis]=useState<Array<{id:string;name:string;model:string;baseUrl:string;enabled:boolean;isDefault:boolean}>>([]);
 const [selectedApi,setSelectedApi]=useState('');
 const [aiEndpoint,setAiEndpoint]=useState('https://api.openai.com/v1/chat/completions');
 const [aiKey,setAiKey]=useState('');
 const [aiBusy,setAiBusy]=useState(false);
 const [apiLoaded,setApiLoaded]=useState(false);
 const loadSavedApis=async()=>{
  try{
   const rows=await db.apiConfigs.toArray();
   setSavedApis(rows.filter(c=>c.enabled).map(c=>({id:c.id,name:c.name,model:c.model,baseUrl:c.baseUrl,enabled:c.enabled,isDefault:c.isDefault})));
   setApiLoaded(true);
  }catch{setNotice('无法读取本地 API 配置。');}
 };
 const inheritApi=async()=>{
  const binding=bindings?.find(b=>b.id===aiBinding&&b.status==='connected');
  if(!binding)return setNotice('请先选择已绑定的角色。');
  const character=await db.characters.get(binding.character_id);
  const configs=await db.apiConfigs.toArray();
  const config=configs.find(c=>c.id===selectedApi&&c.enabled)||
   configs.find(c=>c.id===character?.apiConfigId&&c.enabled)||
   configs.find(c=>c.isDefault&&c.enabled);
  if(!config)return setNotice('没有可用的本地 API，请先在小手机 API 设置中配置。');
  const credential=await db.apiCredentials.get(config.id);
  if(!credential?.apiKey)return setNotice('所选 API 未保存密钥。');
  const endpoint=config.baseUrl.replace(/\/+$/,'')+'/chat/completions';
  if(!window.confirm('从本机读取「'+config.name+'」的模型、端点和密钥并填入微信授权表单？此操作只在本机填写，不会上传；仍需你单独确认云端授权。'))return;
  setSelectedApi(config.id);setAiModel(config.model);setAiEndpoint(endpoint);setAiKey(credential.apiKey);
  setNotice('已从本机填入 '+config.name+'；尚未上传密钥或启用云端 AI。');
 };
 const [memoryStatus,setMemoryStatus]=useState('');
 const [autoMemory,setAutoMemory]=useState(false);
 const [closedContinuity,setClosedContinuity]=useState(false);
 const [autoMemoryBusy,setAutoMemoryBusy]=useState(false);
 useEffect(()=>{
  if(!aiBinding){setAutoMemory(false);setClosedContinuity(false);return;}
  setClosedContinuity(getWechatClosedContinuity(aiBinding));
  setAutoMemory(localStorage.getItem('claudia-wechat-auto-context:'+aiBinding)==='yes');
 },[aiBinding]);
 useEffect(()=>{
  if(!autoMemory||!aiBinding||section!=='account')return;
  const binding=bindings?.find(b=>b.id===aiBinding&&b.status==='connected');
  if(!binding)return;
  let active=true;
  let busy=false;
  const run=async()=>{
   if(!active||busy||document.visibilityState!=='visible')return;
   busy=true;setAutoMemoryBusy(true);
   try{
    const result=await syncWechatEffectiveContext(binding.id,binding.conversation_id);
    if(active)setMemoryStatus('前台自动同步成功：'+result.messageCount+' 段有效上下文');
   }catch(error){
    if(active)setMemoryStatus(error instanceof Error?error.message:'前台自动同步失败');
   }finally{busy=false;if(active)setAutoMemoryBusy(false);}
  };
  void run();
  const interval=window.setInterval(()=>void run(),60000);
  const onVisible=()=>{if(document.visibilityState==='visible')void run();};
  document.addEventListener('visibilitychange',onVisible);
  return ()=>{active=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',onVisible);};
 },[autoMemory,aiBinding,section,bindings]);
 const toggleAutoMemory=(checked:boolean)=>{
  if(!aiBinding)return;
  if(checked&&!window.confirm('开启后，只要这个设置页面保持打开且处于前台，就会定期将角色当前有效上下文同步到你自己的 Supabase。确认开启？'))return;
  localStorage.setItem('claudia-wechat-auto-context:'+aiBinding,checked?'yes':'no');
  setAutoMemory(checked);
 };
 const [messageSyncBusy,setMessageSyncBusy]=useState(false);
 const syncMessages=async()=>{
  const binding=bindings?.find(b=>b.id===aiBinding&&b.status==='connected');
  if(!binding||messageSyncBusy)return;
  setMessageSyncBusy(true);setNotice('');
  try{
   const result=await syncWechatDailyConversation(binding.id,binding.conversation_id,binding.character_id);
   setMemoryStatus(result.hasMore
    ?'已回填 '+result.added+' 条消息，仍有待同步内容，请稍后继续。'
    :'微信消息同步完成，新增 '+result.added+' 条。');
  }catch(error){setNotice(error instanceof Error?error.message:'微信消息回填失败');}
  finally{setMessageSyncBusy(false);}
 };
 const memoryAction=async(action:'sync'|'delete')=>{
  const binding=bindings?.find(b=>b.id===aiBinding&&b.status==='connected');
  if(!binding||aiBusy)return;
  if(action==='sync'&&!window.confirm('将当前日常聊天有效上下文（含角色设定、世界书、记忆和近期消息）上传到你自己的 Supabase 供微信 AI 使用。确定继续？'))return;
  if(action==='delete'&&!window.confirm('确定删除这个角色在云端保存的上下文快照吗？'))return;
  setAiBusy(true);setNotice('');
  try{
   if(action==='sync'){
    const result=await syncWechatEffectiveContext(binding.id,binding.conversation_id);
    setMemoryStatus('已同步 '+result.messageCount+' 段有效上下文；后续本地变化需要重新同步。');
   }else{
    await deleteWechatEffectiveContext(binding.id);
    setMemoryStatus('云端上下文已删除。');
   }
  }catch(error){setNotice(error instanceof Error?error.message:'上下文同步失败');}
  finally{setAiBusy(false);}
 };
 const aiAction=async(action:'status'|'authorize'|'disable'|'delete')=>{
  if(!aiBinding||aiBusy)return;
  setAiBusy(true);setNotice('');
  try{
   if(action==='status'){
    const result=await getWechatAiStatus(aiBinding);
    setAiStatus(result.enabled?'已授权并启用':result.configured?'已配置但停用':'尚未授权');
   }else if(action==='authorize'){
    if(!window.confirm('将当前角色的有效上下文（含设定、世界书、记忆与近期消息）同步到你自己的 Supabase，并加密保存此 API Key 以授权微信云端 AI 回复。确定继续？'))return;
    const binding=bindings?.find(b=>b.id===aiBinding&&b.status==='connected');
    if(!binding)throw Error('微信绑定已失效，请重新查询。');
    // Sync first; never enable cloud replies with a manually diverging persona.
    const synced=await syncWechatEffectiveContext(binding.id,binding.conversation_id);
    setMemoryStatus('已同步 '+synced.messageCount+' 段当前角色有效上下文。');
    await authorizeWechatAi({bindingId:aiBinding,
     systemPrompt:'请严格遵循当前已授权同步的角色有效上下文，不得自行编造角色设定。',
     model:aiModel,endpoint:aiEndpoint,apiKey:aiKey});
    setAiKey('');setAiStatus('已授权并启用');
   }else if(action==='disable'){
    await disableWechatAi(aiBinding);setAiStatus('已停用');
   }else{
    if(!window.confirm('确定删除这个微信角色的云端 AI 配置及已存储的 API Key 吗？'))return;
    await deleteWechatAi(aiBinding);setAiStatus('已删除');
   }
  }catch(error){setNotice(error instanceof Error?error.message:'云端 AI 操作失败');}
  finally{setAiBusy(false);}
 };
 useEffect(()=>{
  if(section!=='account')return;
  void loadSavedApis();
  let active=true;
  void Promise.all([db.conversations.toArray(),db.characters.toArray()]).then(([rows,characters])=>{
   if(!active)return;
   const names=new Map(characters.map(c=>[c.id,c.name]));
   const list=rows.filter(c=>c.mode==='daily'&&!c.worldId).map(c=>({id:c.id,characterId:c.characterId,characterName:names.get(c.characterId)?.trim()||'未命名角色'}));
   setDaily(list);setTarget(current=>current&&list.some(c=>c.id===current)?current:list[0]?.id??'');
  }).catch(()=>setNotice('无法读取日常聊天列表。'));
  return ()=>{active=false;};
 },[section]);
 const begin=async()=>{
  const chosen=daily.find(c=>c.id===target);
  if(!chosen)return setNotice('请选择一个日常角色。');
  setLoading(true);setNotice('');setQr(null);
  try{setQr(await startWechatLogin(chosen.id,chosen.characterId));setQrStatus('等待扫码');}
  catch(error){setNotice(error instanceof Error?error.message:'无法获取二维码');}
  finally{setLoading(false);}
 };
 useEffect(()=>{
  if(!qr||section!=='account'||['已连接','已过期','需要微信验证码（暂不支持）','验证被限制','需要服务端跳转支持','该微信账号已有绑定'].includes(qrStatus))return;
  let cancelled=false;
  const timer=window.setTimeout(async()=>{
   if(cancelled)return;
   setPolling(true);
   try{
    const result=await pollWechatLogin(qr.attemptId);
    if(cancelled)return;
    const names:Record<string,string>={wait:'等待扫码',scaned:'已扫码，请在微信确认',confirmed:'已连接',
      expired:'已过期',need_verifycode:'需要微信验证码（暂不支持）',
      verify_code_blocked:'验证被限制',scaned_but_redirect:'需要服务端跳转支持',
      binded_redirect:'该微信账号已有绑定'};
    setQrStatus(names[result.status]??result.status);
    if(result.status==='confirmed')void load();
    if(result.status==='wait'||result.status==='scaned')setPollTick(v=>v+1);
   }catch(error){if(!cancelled)setNotice(error instanceof Error?error.message:'扫码状态查询失败');}
   finally{if(!cancelled)setPolling(false);}
  },2000);
  return ()=>{cancelled=true;window.clearTimeout(timer);};
 },[qr,section,qrStatus,pollTick]);
 const load=async()=>{
  if(loading)return;
  setLoading(true);setNotice('');
  try{const rows=await listWechatCloudBindings();setBindings(rows);setAiBinding(current=>rows.some(b=>b.id===current&&b.status==='connected')?current:rows.find(b=>b.status==='connected')?.id??'');}
  catch(error){setNotice(error instanceof Error?error.message:'绑定查询失败');}
  finally{setLoading(false);}
 };
 const save=()=>{
  try{saveWechatCloudConfig({url,publishableKey:key});setConfigured(true);setCloudChecks(null);setNotice('微信专用 Supabase 公共配置已保存在本设备。尚未连接微信或部署云端服务。');}
  catch(error){setNotice(error instanceof Error?error.message:'配置保存失败');}
 };
 const clear=()=>{clearWechatCloudConfig();setConfigured(false);setCloudChecks(null);setUrl('');setKey('');setNotice('本设备的微信云端配置已清除。云端已有数据不会因此自动删除。');};
 return <section className="wechat-integration" aria-label="微信接入">
  <div className="wechat-integration__hero"><span className="wechat-integration__eyebrow">PRIVATE CONNECTION</span><h3>微信接入</h3><p>连接自己的微信与云端服务。每位使用者独立配置，不共享聊天或账号。</p></div>
  <button type="button" className="wechat-integration__entry" aria-expanded={section==='cloud'} onClick={()=>{setSection(section==='cloud'?null:'cloud');setNotice('');}}>
   <span className="wechat-integration__entry-icon" aria-hidden="true">☁</span><span className="wechat-integration__entry-text"><strong>微信共享云端后台</strong><small>独立 Supabase 项目与数据</small></span><span className="wechat-integration__entry-status">{configured?'已填写':'未配置'}　›</span>
  </button>
  {section==='cloud'&&<div className="card form wechat-integration__details">
   <p>填写自己的 Supabase 项目 URL 和公开的 publishable / anon Key。不要填写 service_role、secret Key 或数据库密码。</p>
   <label>Supabase 项目 URL
    <input type="url" value={url} onChange={e=>setUrl(e.target.value)}
     placeholder="https://your-project.supabase.co" autoComplete="off"/>
   </label>
   <label>Supabase publishable / anon 公钥
    <input type="text" value={key} onChange={e=>setKey(e.target.value)}
     placeholder="sb_publishable_… 或 anon Key" autoComplete="off"/>
   </label>
   <button type="button" onClick={save}>保存本设备配置</button>
   {configured&&<button type="button" onClick={clear}>清除本设备配置</button>}
   {configured&&<button type="button" disabled={cloudChecking} onClick={()=>{setCloudChecking(true);setCloudChecks(null);void checkCloudReadiness().then(setCloudChecks).catch(e=>setCloudChecks([{name:'连接检测',ok:false,detail:e instanceof Error?e.message:'检测失败'}])).finally(()=>setCloudChecking(false));}}>{cloudChecking?'正在检测…':'检测云端是否可用'}</button>}
   {cloudChecks&&<div role="status" aria-live="polite">{cloudChecks.map(check=><p key={check.name}>{check.ok?'✓':'✕'} {check.name}：{check.detail}</p>)}<p>{cloudChecks.every(check=>check.ok)?'云端基础接口已就绪；仍需验证公共 Railway 绑定和 AI 自动回复。':'当前项目尚未具备完整云端服务。新建的 Supabase 项目需要先安装小手机数据库、Edge Functions 和权限规则，再授权接入公共 Railway。'}</p><p>检测不会自动安装服务，也不需要填写 service_role、数据库密码或其他私密密钥。</p></div>}
   <p>保存配置不代表云端已经部署，也不会自动创建账号或上传本地 API Key。</p>
   <p>勾选主备份的「包含 API 密钥」并设置密码时，微信身份会加密放进同一个 ZIP。微信身份应随主备份一起恢复，不需要在此单独导入。</p>

  </div>}
  <button type="button" className="wechat-integration__entry" aria-expanded={section==='account'} onClick={()=>{setSection(section==='account'?null:'account');setNotice('');}}>
   <span className="wechat-integration__entry-icon" aria-hidden="true">⌗</span><span className="wechat-integration__entry-text"><strong>微信账号绑定</strong><small>扫码登录 · 角色绑定 · AI 回复</small></span><span className="wechat-integration__entry-status">{bindings?.some(b=>b.status==='connected')?'已连接':'待查询'}　›</span>
  </button>
  {section==='account'&&<div className="card form wechat-integration__details">
   <p>微信扫码绑定与云端 AI 授权是两个独立步骤。已有绑定无需重新扫码；连接后还需主动确认一次 AI 授权，才能自动回复。</p>
   <button type="button" disabled={!configured||loading} onClick={()=>void load()}>
    {loading?'正在查询…':'查询我的微信绑定'}
   </button>
   {bindings!==null&&<div aria-live="polite">
    {bindings.length===0?<p>当前没有微信绑定记录。</p>:
     bindings.map(b=><div key={b.id} className="list-row">
      <span>角色 {daily.find(d=>d.characterId===b.character_id)?.characterName??'未命名角色'}</span><span style={{marginLeft:'auto'}}>{b.status}</span>
     </div>)}
   </div>}
   <label>选择日常聊天角色
    <select value={target} onChange={e=>setTarget(e.target.value)} disabled={!!qr&&qrStatus!=='已过期'}>
     {daily.map(d=><option key={d.id} value={d.id}>{d.characterName}</option>)}
    </select>
   </label>
   <button type="button" disabled={!configured||!target||loading} onClick={()=>void begin()}>
    {loading?'正在获取二维码…':qr?'重新生成二维码':'生成微信登录二维码'}
   </button>
   {qr&&<div className="card form" aria-live="polite">
    <p>使用微信扫一扫，并在微信中确认授权。</p>
    <div style={{background:'#fff',padding:16,width:'fit-content',maxWidth:'100%',margin:'auto'}}>
     <WechatQrCode value={qr.qrContent} size={220}/>
    </div>
    <p>扫码状态：{qrStatus}{polling?' · 查询中':''}</p>
    <p>二维码过期时间：{new Date(qr.expiresAt).toLocaleTimeString()}</p>
   </div>}
   {bindings?.some(b=>b.status==='connected')&&<div className="card form">
    <h4>云端 AI 回复授权</h4>
    <p>未授权时微信消息可以接收入库，但 AI 不会自动回复。完成一次明确授权后，无需每次发消息都重新授权。</p>
    <p>只针对你主动选择的已连接微信角色。不会自动读取或上传本地 API Key。确认授权时会先同步当前角色的有效上下文，无需重复填写角色介绍；如果同步失败则不会开启云端 AI。</p>
    <label>已绑定角色
     <select value={aiBinding} onChange={e=>{setAiBinding(e.target.value);setAiStatus('');}}>
      <option value="">选择角色</option>
      {bindings.filter(b=>b.status==='connected').map(b=><option key={b.id} value={b.id}>{daily.find(d=>d.characterId===b.character_id)?.characterName??'未命名角色'}</option>)}
     </select>
    </label>
    <label>继承小手机现有 API
     <select value={selectedApi} onChange={e=>setSelectedApi(e.target.value)}>
      <option value="">自动选择当前角色 API / 全局默认 API</option>
      {savedApis.map(c=><option key={c.id} value={c.id}>{c.name} · {c.model}{c.isDefault?'（全局默认）':''}</option>)}
     </select>
    </label>
    <button type="button" disabled={!aiBinding||!apiLoaded||aiBusy} onClick={()=>void inheritApi()}>继承选中的本地 API</button>
    <p>继承只在本机填入配置，密钥不会自动上传。云端目前仅支持受允许的 OpenAI 兼容端点；其他服务商或自定义域名需要后端适配。</p>
    <label>AI 模型<input value={aiModel} onChange={e=>setAiModel(e.target.value)} placeholder="例如 gpt-4.1-mini"/></label>
    <label>API 端点<input value={aiEndpoint} onChange={e=>setAiEndpoint(e.target.value)}/></label>
    <label>API Key（仅提交到自己的 Supabase）<input type="password" autoComplete="off" value={aiKey} onChange={e=>setAiKey(e.target.value)}/></label>
    <p>微信消息回填：将云端已确认的微信消息合并进当前日常聊天，不会新建第二个聊天。</p>
    <button type="button" disabled={!aiBinding||messageSyncBusy} onClick={()=>void syncMessages()}>{messageSyncBusy?'正在回填微信消息…':'立即同步微信消息到小手机'}</button>
    <p>角色记忆：仅在你确认后，将当前日常聊天实际构建出的角色、世界书、记忆与有效历史同步到自己的云端。</p>
    <label><input type="checkbox" checked={closedContinuity} disabled={!aiBinding}
      onChange={e=>{
       const enabled=e.target.checked;
       if(enabled&&!window.confirm('开启离线微信连续对话：关闭小手机后，已部署的云端执行器可继续保存微信对话；重新打开小手机时自动回填消息并更新记忆快照。不会读取关闭期间未上传的本地数据。确定开启？'))return;
       setWechatClosedContinuity(aiBinding,enabled);setClosedContinuity(enabled);
       if(enabled)void reconcileWechatAfterReopen().catch(()=>setMemoryStatus('离线同步将在下次联网时重试。'));
      }}/>
      关闭小手机后继续保存微信对话，重新打开时自动回填
    </label>
    <label><input type="checkbox" checked={autoMemory} disabled={!aiBinding}
     onChange={e=>toggleAutoMemory(e.target.checked)}/>
     开启前台定期同步（设置页面打开时，每分钟及重新进入前台时同步）{autoMemoryBusy?' · 同步中':''}
    </label>
    <button type="button" disabled={!aiBinding||aiBusy} onClick={()=>void memoryAction('sync')}>同步当前角色完整有效上下文</button>
    <button type="button" disabled={!aiBinding||aiBusy} onClick={()=>void memoryAction('delete')}>删除云端角色上下文</button>
    {memoryStatus&&<p role="status">{memoryStatus}</p>}
    <button type="button" disabled={!aiBinding||aiBusy} onClick={()=>void aiAction('status')}>查询授权状态</button>
    <button type="button" disabled={!aiBinding||!aiModel||!aiKey||aiBusy} onClick={()=>void aiAction('authorize')}>确认授权云端 AI</button>
    <button type="button" disabled={!aiBinding||aiBusy} onClick={()=>void aiAction('disable')}>停用云端 AI</button>
    <button type="button" disabled={!aiBinding||aiBusy} onClick={()=>void aiAction('delete')}>删除云端 AI 配置与密钥</button>
    {aiStatus&&<p role="status">{aiStatus}</p>}
   </div>}
   <p>云端 AI 授权与实际监听器部署是两回事；授权成功不代表微信自动回复已通过测试。</p>
  </div>}
  <button type="button" className="wechat-integration__entry" aria-expanded={section==='qq'} onClick={()=>{setSection(section==='qq'?null:'qq');setNotice('');}}>
   <span className="wechat-integration__entry-icon" aria-hidden="true">QQ</span><span className="wechat-integration__entry-text"><strong>QQ账号绑定</strong><small>QQ 官方机器人 · 扫码绑定 · 角色聊天</small></span><span className="wechat-integration__entry-status">待接入　›</span>
  </button>
  {section==='qq'&&<div className="card form wechat-integration__details">
   <h4>QQ 官方机器人接入</h4>
   <p>将通过腾讯官方 QQ Bot 扫码绑定，而不是登录个人 QQ。QQ 与微信使用独立消息通道，角色设定和记忆仍由小手机管理。</p>
   <p>QQ 沿用微信的 Supabase 身份和云端配置，但使用独立的 QQ 绑定、凭据和消息表。先在「微信共享云端后台」填写你的 Supabase 项目。</p>
   <label>绑定到日常角色<select value={qqTarget} onChange={e=>setQqTarget(e.target.value)}>{daily.map(c=><option key={c.id} value={c.id}>{c.characterName}</option>)}</select></label>
   <button type="button" onClick={()=>void loadQq()}>刷新 QQ 云端绑定</button>
   {qqBindingLoadState==='loading'&&<p role="status">正在恢复云端 QQ 绑定…</p>}
   {qqBindingLoadState==='error'&&<p role="alert">QQ 绑定查询失败，不代表绑定已失效。请保留当前数据，稍后重试。</p>}
   {qqBindingLoadState==='loaded'&&qqBindings.length===0&&<p role="status">当前云端身份下未查询到 QQ 绑定。若以前绑定过，请先核对身份及使用的网址，不要直接重新扫码。</p>}
   {qqBindings.some(b=>b.status==='connected')&&<p role="status">已找到现有 QQ 绑定。重新打开小手机无需重新扫码；若 QQ 不回复，请先查看下方「QQ 云端 AI 回复授权」的状态。</p>}
   {qqAiStatus==='尚未授权'&&<p role="alert">当前 QQ 已连接，但云端 AI 尚未授权，因此 QQ 消息不会生成回复。请在下方继承本地 API，并点击「确认授权 QQ 云端 AI」。无需重新扫码。</p>}
   {qqBindings.map(b=><div key={b.id} className="card form"><p>角色：{daily.find(c=>c.id===b.conversation_id)?.characterName||b.character_id} · {b.status}</p><button type="button" disabled={qqBusy} onClick={()=>{if(window.confirm('断开这个 QQ 绑定并清除云端凭据？'))void disconnectQqCloudBinding(b.id).then(loadQq).catch(e=>setQqNotice(e instanceof Error?e.message:'解绑失败'));}}>断开 QQ 绑定</button></div>)}
   {qqBindings.some(b=>b.status==='connected')&&<div className="card form">
    <h4>QQ 云端 AI 回复授权</h4>
    <p>QQ 绑定已连接，无需重新扫码。QQ 与微信的 AI 授权独立，首次授权会先同步角色当前有效上下文。</p>
    <label>已连接的 QQ 角色<select value={qqAiBinding} onChange={e=>{setQqAiBinding(e.target.value);setQqAiStatus('');}}>
     {qqBindings.filter(b=>b.status==='connected').map(b=><option key={b.id} value={b.id}>{daily.find(d=>d.id===b.conversation_id)?.characterName||b.character_id}</option>)}
    </select></label>
    <label>继承小手机 API<select value={qqApiId} onChange={e=>setQqApiId(e.target.value)}>
     <option value="">自动选择角色 API / 全局默认</option>
     {qqApis.map(a=><option key={a.id} value={a.id}>{a.name} · {a.model}</option>)}
    </select></label>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqAuthorizeLocal()}>使用当前角色 API 一键授权 QQ 回复</button>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqInheritApi().catch(e=>setQqNotice(e instanceof Error?e.message:'读取 API 失败'))}>继承本地 API</button>
    <label>模型<input value={qqAiModel} onChange={e=>setQqAiModel(e.target.value)}/></label>
    <label>API 端点<input value={qqAiEndpoint} onChange={e=>setQqAiEndpoint(e.target.value)} placeholder="https://api.example.com/v1/chat/completions"/></label>
    <label>API Key<input type="password" autoComplete="off" value={qqAiKey} onChange={e=>setQqAiKey(e.target.value)}/></label>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqAiAction('status')}>查询授权状态</button>
    <button type="button" disabled={qqAiBusy||!qqAiBinding||!qqAiModel||!qqAiEndpoint||!qqAiKey} onClick={()=>void qqAiAction('authorize')}>确认授权 QQ 云端 AI</button>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqAiAction('sync')}>重新同步角色记忆</button>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqAiAction('disable')}>停用 QQ AI</button>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqAiAction('delete')}>删除 QQ AI 授权与密钥</button>
    <button type="button" disabled={qqAiBusy||!qqAiBinding} onClick={()=>void qqAiAction('delete-context')}>删除 QQ 云端上下文</button>
    {qqAiStatus&&<p role="status">{qqAiStatus}</p>}
    {qqContextStatus&&<p role="status">{qqContextStatus}</p>}
    <p>角色记忆仅在授权或手动同步时更新；关闭小手机后，未同步的本地变化无法自动上传。</p>
   </div>}
   <button type="button" disabled={qqBusy} onClick={()=>void beginQq()}>{qqBusy?'正在生成…':'生成 QQ 绑定二维码'}</button>
   {qqSession&&<div className="card form" aria-live="polite">
     {qqSession.qrContent?.startsWith('https://') && <div style={{textAlign:'center'}}><WechatQrCode value={qqSession.qrContent} size={220} label="QQ 官方机器人授权二维码"/></div>}
     {qqSession.qrContent?.startsWith('data:image/png;base64,') && <img src={qqSession.qrContent} alt="QQ 官方机器人授权二维码" width={220} height={220} style={{display:'block',margin:'auto'}}/>}
     {qqSession.qrContent && !qqSession.qrContent.startsWith('https://') && !qqSession.qrContent.startsWith('data:image/png;base64,') && <p>二维码内容格式不受支持，请重新生成。</p>}
    <p>扫码状态：{qqSession.status==='waiting'?'等待扫码':qqSession.status==='refreshing'?'二维码刷新中':qqSession.status==='storage_not_configured'?'扫码完成，但凭据安全保存尚未配置':qqSession.status==='failed'?'授权失败':qqSession.status}</p>
    <p>会话过期：{new Date(qqSession.expiresAt).toLocaleTimeString()}</p>
   </div>}
   {qqNotice&&<p role="alert">{qqNotice}</p>}
   <p>点击「生成 QQ 绑定二维码」后，使用腾讯官方 QQ Bot 授权流程扫码；若云端服务未配置或授权失败，会显示具体错误，不会生成虚假二维码。</p>
   <p>后端健康检查：<a href="https://qq-qr-bridge-production.up.railway.app/health" target="_blank" rel="noopener noreferrer">检查 QQ 扫码服务</a>。此地址只检查服务运行，不会生成二维码。</p>
   <a href="https://github.com/tencent-connect/openclaw-qqbot" target="_blank" rel="noopener noreferrer">查看腾讯官方 QQ Bot 扫码接入说明</a>
   <p>QQ 绑定未完成前，微信连接、角色数据与已有聊天不会改变。</p>
  </div>}
  {notice&&<p className="wechat-integration__notice" role="status">{notice}</p>}
 </section>;
}
