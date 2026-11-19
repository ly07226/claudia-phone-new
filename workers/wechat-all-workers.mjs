// Dedicated always-on entrypoint. All three processes use the same private
// Supabase project and remain isolated from the Vite frontend.
import {spawn} from 'node:child_process';
const jobs=[
 ['listener','wechat-listener.mjs'],
 ['ai','wechat-ai-worker.mjs'],
 ['sender','wechat-send-scheduler.mjs'],
];
const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','WECHAT_ILINK_ENCRYPTION_KEY','WECHAT_BRIDGE_WORKER_SECRET'];
const missing=required.filter(k=>!process.env[k]);
if(missing.length)throw Error('Missing server-only variables: '+missing.join(', '));
const children=new Map();
let stopping=false;
function stop(signal='SIGTERM'){
 if(stopping)return;
 stopping=true;
 for(const child of children.values())if(child.exitCode===null)child.kill(signal);
}
process.on('SIGTERM',()=>stop());
process.on('SIGINT',()=>stop('SIGINT'));
for(const [name,file] of jobs){
 const child=spawn(process.execPath,[new URL(file,import.meta.url).pathname],{
  env:process.env,stdio:'inherit'
 });
 children.set(name,child);
 child.on('error',error=>{console.error(name+' worker start failed:',String(error));stop();process.exitCode=1;});
 child.on('exit',(code,signal)=>{
  if(!stopping){console.error(name+' worker exited unexpectedly:',code,signal);stop();process.exitCode=1;}
  children.delete(name);
  if(children.size===0)process.exit(process.exitCode??0);
 });
}
