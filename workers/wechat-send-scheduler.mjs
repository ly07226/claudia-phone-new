// Server-only scheduler for the existing Supabase outbound Edge Function.
// Never deploy this in the browser. A single replica is sufficient.
import {setTimeout as sleep} from 'node:timers/promises';
const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
const secret=process.env.WECHAT_BRIDGE_WORKER_SECRET;
if(!base||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)||!secret||secret.length<32)
 throw Error('SUPABASE_URL and WECHAT_BRIDGE_WORKER_SECRET (32+ chars) are required');
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});
process.on('SIGINT',()=>{stopping=true;});
while(!stopping){
 try{
  const response=await fetch(base+'/functions/v1/claudia-wechat-send',{
   method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
   body:'{}',signal:AbortSignal.timeout(65000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok){
   console.error('wechat sender HTTP',response.status,data?.error||'unknown');
   await sleep(5000);
  }else if(data?.status==='idle'){
   await sleep(2000);
  }else if(data?.ok!==true){
   console.error('wechat sender unexpected result',data?.error||'invalid_response');
   await sleep(5000);
  }else{
   // Bound request rate even when the queue is continuously non-empty.
   await sleep(750);
  }
 }catch(error){console.error('wechat sender request failed',String(error));await sleep(5000);}
}
