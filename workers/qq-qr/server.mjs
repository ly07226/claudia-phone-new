// QQ Bot QR bridge: a short-lived, server-side connector. No QQ credentials are returned to browsers.
// Run with Node >=20 and install @tencent-connect/qqbot-connector@1.2.0.
// Configure QQ_QR_ORIGIN (exact frontend origin) and QQ_QR_ACCESS_TOKEN (random 32+ byte secret).
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { startQrConnect } from '@tencent-connect/qqbot-connector';
import { startQqGateway } from './gateway.mjs';
import {TenantRegistry} from './tenant-registry.mjs';
import {createTenantDispatcher} from './tenant-dispatcher.mjs';

const origin=process.env.QQ_QR_ORIGIN;
const token=process.env.QQ_QR_ACCESS_TOKEN;
if(!origin||!/^https:\/\//.test(origin)||!token||token.length<32)throw Error('QQ_QR_ORIGIN and QQ_QR_ACCESS_TOKEN (32+ chars) required');
const sessions=new Map();
const listeners=new Map();
const botAccounts=new Map();
const supabaseUrl=process.env.QQ_SUPABASE_URL;
// Optional server-only configuration; disabled by default to preserve existing service.
const tenantRegistry=new TenantRegistry();
const tenantBridgeTokens=new Map();
if(process.env.QQ_MULTITENANT_ENABLED==='true'){
 const records=JSON.parse(process.env.QQ_TENANTS_JSON||'[]');
 if(!Array.isArray(records)||records.length>100)throw Error('invalid_tenant_configuration');
 for(const record of records){
  if(typeof record.bridgeToken!=='string'||record.bridgeToken.length<32)throw Error('invalid_tenant_bridge_token');
  tenantRegistry.register(record);
  tenantBridgeTokens.set(record.tenantId,record.bridgeToken);
 }
}
const dispatchTenant=createTenantDispatcher({registry:tenantRegistry,timeoutMs:120000});
let tenantAiTickRunning=false;
async function runTenantAiTick(){
 if(tenantAiTickRunning||!tenantBridgeTokens.size)return;
 tenantAiTickRunning=true;
 try{
  for(const [tenantId,accessToken] of tenantBridgeTokens){
   try{
    const result=await dispatchTenant({tenantId,functionName:'claudia-qq-ai-run',body:{},accessToken});
    if(result.status!=='idle')console.info('qq_tenant_ai_tick',tenantId,result.status);
   }catch(error){console.warn('qq_tenant_ai_tick_failed',tenantId,error instanceof Error?error.message:'unknown');}
  }
 }finally{tenantAiTickRunning=false;}
}

function startListener(account,tenantId=null){
 const project=tenantId?tenantRegistry.get(tenantId):null;
 if(tenantId&&!project)throw Error('tenant_not_registered');
 if(!account?.bindingId||!account?.appId||!account?.appSecret)throw Error('invalid_qq_account');
 const key=tenantId+':'+account.bindingId;
 const appKey=tenantId+':'+account.appId;
 // A QQ app can have only one active listener per tenant; remove superseded outbound entries.
 for(const [existingKey,existing] of botAccounts){
  if(existing.tenantId===tenantId&&(existingKey===key||existing.appId===account.appId)){
   const oldKey=tenantId+':'+existing.appId;
   const stop=listeners.get(oldKey);
   if(typeof stop==='function')stop();
   listeners.delete(oldKey);
   botAccounts.delete(existingKey);
  }
 }
 const stop=startQqGateway({appId:account.appId,appSecret:account.appSecret,
  bindingId:account.bindingId,supabaseUrl:project?.projectUrl||supabaseUrl,
  bridgeToken:tenantId?tenantBridgeTokens.get(tenantId):token,
  onStatus:state=>{console.info('qq_gateway',tenantId||'legacy',account.bindingId,state);}});
 listeners.set(appKey,stop);
 botAccounts.set(key,{appId:account.appId,appSecret:account.appSecret,bindingId:account.bindingId,tenantId});
}
async function restoreListeners(){
 if(!supabaseUrl)return;
 try{
  const response=await fetch(supabaseUrl+'/functions/v1/claudia-qq-bridge-restore',{
   method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('restore_http_'+response.status);
  const result=await response.json();
  if(!result.ok||!Array.isArray(result.accounts))throw Error('invalid_restore_response');
  for(const account of result.accounts){
   if(typeof account.bindingId==='string'&&typeof account.appId==='string'&&typeof account.appSecret==='string'&&!listeners.has('null:'+account.appId))
    startListener(account);
  }
  console.info('qq_gateway_restore_count',result.accounts.length);
 }catch(error){console.warn('qq_gateway_restore_failed',error instanceof Error?error.message:'unknown');}
}

async function confirmBinding(id,credentials,tenantId=null){
 const project=tenantId?tenantRegistry.get(tenantId):null;
 if(tenantId&&!project)throw Error('tenant_not_registered');
 const destination=project?.projectUrl||supabaseUrl;
 if(!destination||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(destination))throw Error('supabase_not_configured');
 const endpoint=destination+'/functions/v1/claudia-qq-bridge-confirm';
 const bridgeCredential=tenantId?tenantBridgeTokens.get(tenantId):token;
 for(let attempt=0;attempt<8;attempt++){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bridgeCredential},
   body:JSON.stringify({bridgeAttemptId:id,credentials}),signal:AbortSignal.timeout(12000)});
  if(response.ok){const result=await response.json();if(typeof result.bindingId!=='string')throw Error('missing_binding_id');return result.bindingId;}
  // The QR may complete before the owner's attempt record is committed.
  if(response.status!==409&&response.status!==404)throw Error('confirmation_failed');
  await new Promise(resolve=>setTimeout(resolve,750));
 }
 throw Error('confirmation_timeout');
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Vary':'Origin'});res.end(JSON.stringify(data));};
function tokenEquals(supplied,expected){if(typeof expected!=='string')return false;const a=Buffer.from(supplied),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
function authorized(req){return tokenEquals(req.headers.authorization?.replace(/^Bearer /,'')||'',token);}
function authorizedTenant(req,tenantId){return tenantBridgeTokens.has(tenantId)&&tokenEquals(req.headers.authorization?.replace(/^Bearer /,'')||'',tenantBridgeTokens.get(tenantId));}
function cleanup(){for(const [id,s] of sessions){if(Date.now()>s.until){if(typeof s.stop==='function')s.stop();sessions.delete(id);}}}
setInterval(cleanup,30000).unref();
http.createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health')return json(res,200,{status:'ok'});
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'});return res.end();}
 const path=new URL(req.url||'/', 'http://localhost').pathname;
 const tenantId=req.headers['x-claudia-tenant-id'];
 const tenantMode=typeof tenantId==='string'&&tenantId.length>0;
 // The existing global token must never authorize a tenant request.
 if(req.headers.origin!==origin||!(tenantMode?authorizedTenant(req,tenantId):authorized(req)))return json(res,403,{error:'unauthorized'});
 if(req.method==='POST'&&path==='/qq/qr/start'){
  cleanup();if(sessions.size>=5)return json(res,429,{error:'too_many_sessions'});
  const id=randomUUID();const s={status:'waiting',url:null,until:Date.now()+10*60*1000,stop:null,tenantId:tenantMode?tenantId:null};sessions.set(id,s);
  try{
   const connector=startQrConnect({
    onQrDisplayed(url){if(typeof url==='string'&&/^(https:\/\/|data:image\/png;base64,)/.test(url)){s.url=url;s.status='waiting';}},
    onQrExpired(){s.url=null;s.status='refreshing';},
    onSuccess(credentials){
     if(!Array.isArray(credentials)||credentials.length!==1||credentials.some(c=>!c?.appId||!c?.appSecret)){s.status='failed';return;}
     s.status='confirming';s.url=null;
     void confirmBinding(id,credentials,s.tenantId).then(bindingId=>{
      s.status='connected';
      const account=credentials[0];
      startListener({appId:account.appId,appSecret:account.appSecret,bindingId},s.tenantId);
     }).catch(()=>{s.status='storage_not_configured';});
    },
    onFailure(){s.status='failed';s.url=null;}
   },{displayQrCodeToConsole:false});
   Promise.resolve(connector).then(stop=>{if(typeof stop==='function')s.stop=stop;}).catch(()=>{s.status='failed';s.url=null;});
   return json(res,200,{attemptId:id,status:s.status,qrContent:s.url,expiresAt:new Date(s.until).toISOString()});
  }catch{sessions.delete(id);return json(res,502,{error:'qq_connector_failed'});}
 }
 const match=path.match(/^\/qq\/qr\/([0-9a-f-]{36})$/);
 if(req.method==='GET'&&match){const s=sessions.get(match[1]);if(s&&s.tenantId!==(tenantMode?tenantId:null))return json(res,404,{error:'expired'});return s?json(res,200,{status:s.status,qrContent:s.url,expiresAt:new Date(s.until).toISOString()}):json(res,404,{error:'expired'});}
 return json(res,404,{error:'not_found'});
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{void restoreListeners();});
// Recover automatically if Supabase was temporarily unavailable during startup.
setInterval(()=>{void restoreListeners();},5*60*1000).unref();

// Reuse the existing Railway service for QQ AI processing; never invoke without owner authorization.
let aiTickRunning=false;
async function runAiTick(){
 if(aiTickRunning||!supabaseUrl)return;
 aiTickRunning=true;
 try{
  const response=await fetch(supabaseUrl+'/functions/v1/claudia-qq-ai-run',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:'{}',signal:AbortSignal.timeout(145000)});
  if(!response.ok)console.warn('qq_ai_tick_failed','http_'+response.status);
  else{const data=await response.json();if(data.status!=='idle')console.info('qq_ai_tick',data.status,data.generated===true);}
 }catch(error){console.warn('qq_ai_tick_failed',error instanceof Error?error.name:'unknown');}
 finally{aiTickRunning=false;}
}
setInterval(()=>{void runAiTick();},5000).unref();
setInterval(()=>{void runTenantAiTick();},5000).unref();

let sendTickRunning=false;
async function sendTick(){
 if(sendTickRunning||!supabaseUrl)return;
 sendTickRunning=true;
 try{
  for(const [bindingKey,account] of botAccounts){
   const bindingId=account.bindingId;
   const project=account.tenantId?tenantRegistry.get(account.tenantId):null;
   if(account.tenantId&&!project)continue;
   const queue=async body=>{
    const response=await fetch((project?.projectUrl||supabaseUrl)+'/functions/v1/claudia-qq-outbound',{
     method:'POST',headers:{Authorization:'Bearer '+(account.tenantId?tenantBridgeTokens.get(account.tenantId):token),'Content-Type':'application/json'},
     body:JSON.stringify({bindingId,...body}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('qq_outbound_queue_http_'+response.status);
    return response.json();
   };
   const result=await queue({action:'claim'});
   if(result.status!=='claimed')continue;
   const msg=result.message;
   let success=false,error='send_failed';
   try{
    if(!msg||!['c2c','group'].includes(msg.routeType)||typeof msg.routeTarget!=='string'||
       !msg.routeTarget||typeof msg.replyTo!=='string'||!msg.replyTo||
       !Number.isInteger(msg.msgSeq)||msg.msgSeq<1||msg.msgSeq>32||
       typeof msg.body!=='string'||!msg.body.trim())throw Error('invalid_outbound_route');
    const auth=await fetch('https://bots.qq.com/app/getAppAccessToken',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({appId:account.appId,clientSecret:account.appSecret}),signal:AbortSignal.timeout(12000)});
    if(!auth.ok)throw Error('qq_token_http_'+auth.status);
    const access=(await auth.json()).access_token;
    if(typeof access!=='string'||!access)throw Error('invalid_qq_token');
    const path=msg.routeType==='c2c'?'/v2/users/'+encodeURIComponent(msg.routeTarget)+'/messages':
     '/v2/groups/'+encodeURIComponent(msg.routeTarget)+'/messages';
    const sent=await fetch('https://api.bot.qq.com'+path,{
     method:'POST',headers:{Authorization:'QQBot '+access,'Content-Type':'application/json'},
     body:JSON.stringify({content:msg.body,msg_type:0,msg_id:msg.replyTo,msg_seq:msg.msgSeq}),
     signal:AbortSignal.timeout(20000)});
    if(!sent.ok)throw Error('qq_send_http_'+sent.status);
    success=true;
   }catch(e){
    const raw=e instanceof Error?e.message:'send_failed';
    error=/^(qq_token_http_\d+|qq_send_http_\d+|invalid_qq_token|invalid_outbound_route)$/.test(raw)?raw:'send_failed';
    console.warn('qq_outbound_send_failed',bindingId,error);
   }
   try{await queue({action:'finish',messageId:msg.id,leaseUntil:msg.leaseUntil,success,error});}
   catch(e){console.warn('qq_outbound_finish_failed',bindingId,e instanceof Error?e.name:'unknown');}
   if(success)console.info('qq_outbound_sent',bindingId);
  }
 }catch(e){console.warn('qq_outbound_tick_failed',e instanceof Error?e.message:'unknown');}
 finally{sendTickRunning=false;}
}
setInterval(()=>{void sendTick();},1000).unref();
