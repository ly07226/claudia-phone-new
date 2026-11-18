// One replica per user-owned Supabase project. Node 20+; no browser secrets.
// Poll iLink -> atomically persist verified text + encrypted reply routing -> save cursor.
// Does not generate AI responses; a separate authorized generation worker is required.
const env=process.env;
const base=env.SUPABASE_URL?.replace(/\/$/,'');
const key=env.SUPABASE_SERVICE_ROLE_KEY;
const encryption=env.WECHAT_ILINK_ENCRYPTION_KEY;
if(!base||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)||!key||!encryption)
 throw Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WECHAT_ILINK_ENCRYPTION_KEY required');
const {webcrypto,randomBytes}=await import('node:crypto');
const {setTimeout:sleep}=await import('node:timers/promises');
const raw=Buffer.from(encryption,'base64');
if(raw.length!==32)throw Error('WECHAT_ILINK_ENCRYPTION_KEY must be 32 bytes in base64');
const aes=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
async function decrypt(value){
 const [iv,data]=value.split('.');
 if(!iv||!data)throw Error('invalid ciphertext');
 return Buffer.from(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},aes,Buffer.from(data,'base64'))).toString('utf8');
}
async function encrypt(value){
 const iv=randomBytes(12);
 const ciphertext=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},aes,Buffer.from(value));
 return iv.toString('base64')+'.'+Buffer.from(ciphertext).toString('base64');
}
async function rest(path,{method='GET',body}={}){
 const response=await fetch(base+'/rest/v1/'+path,{
  method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',
   Prefer:method==='POST'?'resolution=merge-duplicates,return=representation':'return=representation'},
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('supabase HTTP '+response.status);
 return response.status===204?null:response.json();
}
async function rpc(name,body){
 const response=await fetch(base+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('rpc '+name+' HTTP '+response.status);
 return response.json();
}
function originAllowed(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname.endsWith('.weixin.qq.com')&&
   u.username===''&&u.password===''&&u.search===''&&u.hash==='';}catch{return false;}
}
async function poll(binding){
 const credentials=await rest('claudia_wechat_credentials?binding_id=eq.'+encodeURIComponent(binding.id)+
  '&select=bot_token_ciphertext,api_base_url');
 const credential=credentials?.[0];
 if(!credential||!originAllowed(credential.api_base_url))throw Error('missing iLink credential');
 const token=await decrypt(credential.bot_token_ciphertext);
 const cursorRows=await rest('claudia_wechat_poll_cursors?binding_id=eq.'+encodeURIComponent(binding.id)+
  '&select=get_updates_buf');
 const cursor=cursorRows?.[0]?.get_updates_buf||'';
 const response=await fetch(credential.api_base_url.replace(/\/$/,'')+'/ilink/bot/getupdates',{
  method:'POST',headers:{Authorization:'Bearer '+token,AuthorizationType:'ilink_bot_token',
   'Content-Type':'application/json','X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')},
  body:JSON.stringify({get_updates_buf:cursor,base_info:{channel_version:'1.0.0'}}),
  signal:AbortSignal.timeout(65000)});
 if(!response.ok)throw Error('iLink HTTP '+response.status);
 const data=await response.json();
 if(Object.hasOwn(data,'ret')&&data.ret!==0){
  // Only numeric response code; never log tokens, messages, or response bodies.
  const code=typeof data.ret==='number'&&Number.isSafeInteger(data.ret)?data.ret:'invalid';
  throw Error('iLink getupdates rejected (ret='+code+')');
 }
 if(!Array.isArray(data.msgs)||typeof data.get_updates_buf!=='string'){
  // Safe shape diagnostics: never log raw response, credentials or messages.
  throw Error('invalid getupdates shape (msgs='+Array.isArray(data.msgs)+',cursor='+(typeof data.get_updates_buf)+',keys='+Object.keys(data).filter(k=>/^(ret|errcode|errmsg|msgs|get_updates_buf|message_list|messages|next_cursor)$/.test(k)).join(',')+')');
 }
 if(data.msgs.length>500)throw Error('unexpected message batch');
 for(const msg of data.msgs){
  if(!msg||typeof msg!=='object')continue;
  // Never import messages dated before this binding. An absent or malformed
  // source timestamp is not proof that a message is new: fail closed.
  const sourceTime=msg.create_time;
  const seconds=typeof sourceTime==='number'?sourceTime:
   typeof sourceTime==='string'&&/^\d{10,13}$/.test(sourceTime)?Number(sourceTime):NaN;
  const eventMs=seconds>=1e12?seconds:seconds*1000;
  const boundMs=Date.parse(binding.created_at);
  if(!Number.isFinite(eventMs)||!Number.isFinite(boundMs)){
   throw Error('iLink event timestamp missing or invalid; refusing to ingest unverified history');
  }
  if(eventMs<boundMs)continue;
  const text=(Array.isArray(msg.item_list)?msg.item_list:[])
   .filter(item=>item?.type===1&&typeof item.text_item?.text==='string')
   .map(item=>item.text_item.text).join('\n').trim();
  if(!text)continue; // unsupported media never interpreted as text
  const peer=msg.from_user_id,context=msg.context_token;
  const messageId=msg.message_id;
  if(typeof peer!=='string'||!peer||typeof context!=='string'||!context||
     (!Number.isSafeInteger(messageId)&&typeof messageId!=='string')||
     text.length>8000)throw Error('invalid incoming route; cursor not advanced');
  await rpc('claudia_wechat_receive_routed_text',{
   p_user_id:binding.user_id,p_binding_id:binding.id,
   p_external_message_id:String(messageId),p_body:text,
   p_peer_ciphertext:await encrypt(peer),p_context_ciphertext:await encrypt(context)});
 }
 // Cursor advances only after all supported inbound text is durably stored.
 await rest('claudia_wechat_poll_cursors?on_conflict=binding_id',{
  method:'POST',body:{binding_id:binding.id,get_updates_buf:data.get_updates_buf,
   updated_at:new Date().toISOString()}});
 return data.msgs.length;
}
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});
process.on('SIGINT',()=>{stopping=true;});
while(!stopping){
 try{
  const bindings=await rest('claudia_wechat_bindings?status=eq.connected&select=id,user_id,created_at&limit=100');
  for(const binding of bindings||[]){
   if(stopping)break;
   try{await poll(binding);}
   catch(error){console.error('wechat polling failed',binding.id,String(error));await sleep(2000);}
  }
  if(!bindings?.length)await sleep(5000);
 }catch(error){console.error('wechat worker loop failed',String(error));await sleep(5000);}
}
