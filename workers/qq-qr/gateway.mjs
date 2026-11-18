// QQ official gateway, one socket per authorized bot. Never expose app credentials to browsers.
const API='https://api.bot.qq.com';
const TOKEN='https://bots.qq.com/app/getAppAccessToken';
const INTENTS=1<<25; // C2C and group @ messages
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function startQqGateway({appId,appSecret,bindingId,supabaseUrl,bridgeToken,onStatus=()=>{}}){
 let stopped=false,ws=null,heartbeat=null,retry=0,sessionId=null,seq=null;
 const clear=()=>{if(heartbeat)clearInterval(heartbeat);heartbeat=null;};
 const post=async(event)=>{
  if(!['C2C_MESSAGE_CREATE','GROUP_AT_MESSAGE_CREATE'].includes(event.t))return;
  const d=event.d||{};
  if(typeof d.id!=='string'||typeof d.content!=='string'||!d.content.trim())return;
  const response=await fetch(supabaseUrl+'/functions/v1/claudia-qq-ingest',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bridgeToken},
   body:JSON.stringify({bindingId,externalMessageId:d.id,text:d.content}),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error('qq_ingest_'+response.status);
 };
 const getToken=async()=>{
  const response=await fetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({appId,clientSecret:appSecret}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('qq_token_http_'+response.status);
  const data=await response.json();
  if(typeof data.access_token!=='string'||!data.access_token)throw Error('qq_token_invalid');
  return data.access_token;
 };
 const connect=async()=>{
  while(!stopped){
   try{
    const token='QQBot '+await getToken();
    const gateway=await fetch(API+'/gateway',{headers:{Authorization:token},signal:AbortSignal.timeout(12000)});
    if(!gateway.ok)throw Error('qq_gateway_http_'+gateway.status);
    const info=await gateway.json();
    if(typeof info.url!=='string'||!info.url.startsWith('wss://'))throw Error('qq_gateway_url_invalid');
    await new Promise((resolve,reject)=>{
     let settled=false;
     const socket=new WebSocket(info.url);ws=socket;
     const send=(op,d)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({op,d}));};
     socket.onmessage=event=>{
      let packet;try{packet=JSON.parse(event.data);}catch{return;}
      if(packet.op===10){
       const interval=Number(packet.d?.heartbeat_interval);
       if(!Number.isFinite(interval)||interval<1000){socket.close();return;}
       send(sessionId&&seq!==null?6:2,sessionId&&seq!==null?
        {token,session_id:sessionId,seq}:
        {token,intents:INTENTS,shard:[0,1],properties:{$os:'linux',$browser:'claudia-phone',$device:'railway'}});
       clear();heartbeat=setInterval(()=>send(1,seq),interval);
      }
      if(packet.op===0){
       if(Number.isSafeInteger(packet.s))seq=packet.s;
       if(packet.t==='READY'){sessionId=packet.d?.session_id||null;retry=0;onStatus('connected');}
       if(packet.t==='RESUMED'){retry=0;onStatus('connected');}
       void post(packet).catch(()=>onStatus('ingest_failed'));
      }
      if(packet.op===7)socket.close();
      if(packet.op===9){sessionId=null;seq=null;socket.close();}
     };
     socket.onerror=()=>onStatus('gateway_error');
     socket.onclose=event=>{clear();if([4001,4002,4010,4011,4012,4013,4014,4914,4915].includes(event.code)){stopped=true;onStatus('gateway_rejected');}if(!settled){settled=true;resolve();}};
    });
   }catch{onStatus('gateway_retrying');}
   if(stopped)break;
   retry=Math.min(retry+1,8);await sleep(Math.min(60000,1000*2**retry)+Math.floor(Math.random()*500));
  }
 };
 void connect();
 return ()=>{stopped=true;clear();if(ws)ws.close();};
}
