import {useEffect,useState} from 'react';

const STORAGE_KEY='claudia:audio-keepalive-enabled';
const TONE_SECONDS=30;
/** A genuine silent WAV played as media, not a busy JavaScript timer. */
function silentWav():string {
 const sampleRate=8000, samples=sampleRate*TONE_SECONDS;
 const bytes=new Uint8Array(44+samples*2);
 const view=new DataView(bytes.buffer);
 const ascii=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i);};
 ascii(0,'RIFF');view.setUint32(4,bytes.length-8,true);ascii(8,'WAVE');ascii(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);
 ascii(36,'data');view.setUint32(40,samples*2,true);
 let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
 return 'data:audio/wav;base64,'+btoa(binary);
}
let media:HTMLAudioElement|undefined;
function player():HTMLAudioElement {
 if(!media){media=new Audio(silentWav());media.loop=true;media.preload='auto';media.volume=1;
  media.setAttribute('playsinline','');}
 return media;
}
type KeepAliveSnapshot={enabled:boolean;playing:boolean;error:string};
const readEnabled=()=>{try{return localStorage.getItem(STORAGE_KEY)==='true';}catch{return false;}};
export function audioKeepAliveEnabled(){return readEnabled();}
let snapshot:KeepAliveSnapshot={enabled:readEnabled(),playing:false,error:''};
const subscribers=new Set<()=>void>();
function publish(patch:Partial<KeepAliveSnapshot>){snapshot={...snapshot,...patch};subscribers.forEach(listener=>listener());}
let initialized=false;
let operation=0;
let pending=false;
/** Persistent audio owner: listeners must survive leaving Settings for Chat. */
export function initializeAudioKeepAlive(){
 if(initialized)return;
 initialized=true;
 const audio=player();
 const sync=()=>publish({playing:!audio.paused&&!audio.ended});
 const resume=()=>{
  if(!readEnabled()||!audio.paused)return;
  if(pending)return;
  const token=++operation;pending=true;
  void audio.play().then(()=>{if(token===operation)publish({enabled:true,playing:true,error:''});}).catch(()=>{if(token===operation)publish({playing:false,error:'系统中断了播放，请在设置中手动恢复。'});}).finally(()=>{if(token===operation)pending=false;});
 };
 audio.addEventListener('play',sync);
 audio.addEventListener('pause',sync);
 audio.addEventListener('ended',sync);
 audio.addEventListener('error',()=>publish({playing:false,error:'音频播放失败，请重新开启。'}));
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();});
 window.addEventListener('pageshow',resume);
 // On a fresh page load, autoplay may be blocked. A user gesture can restore it.
 if(readEnabled())resume();
}
export function AudioKeepAliveSettings(){
 const [state,setState]=useState<KeepAliveSnapshot>(()=>snapshot);
 useEffect(()=>{
  initializeAudioKeepAlive();
  const sync=()=>setState(snapshot);
  subscribers.add(sync);sync();
  return()=>{subscribers.delete(sync);};
 },[]);
 async function toggle(){
  initializeAudioKeepAlive();
  const audio=player();
  if(pending)return;
  if(readEnabled()&&!audio.paused){
   ++operation;
   try{localStorage.removeItem(STORAGE_KEY);}catch{}
   audio.pause();audio.currentTime=0;
   publish({enabled:false,playing:false,error:''});
   return;
  }
  const token=++operation;pending=true;
  try{
   await audio.play();
   if(token!==operation)return;
   try{localStorage.setItem(STORAGE_KEY,'true');}catch{}
   publish({enabled:true,playing:true,error:''});
  }catch(e){if(token===operation)publish({playing:false,error:e instanceof Error?e.message:'音频启动失败，请点击重试。'});}
  finally{if(token===operation)pending=false;}
 }
 return <section className="card form" aria-label="后台音频保活">
  <h3>后台音频保活</h3>
  <p className="hint">开启一次后持续循环播放无声音频，切换聊天页面不会停止。手动关闭才停止；系统强制中断后会尝试恢复。</p>
  <button type="button" className="list-row" onClick={()=>void toggle()} aria-pressed={state.playing}>
   <span>{state.enabled&&state.playing?'关闭后台保活':'开启后台保活'}</span>
   <span>{state.playing?'循环播放中':state.enabled?'等待恢复':'关闭'}</span>
  </button>
  {state.error&&<p role="status">{state.error}</p>}
  <p className="hint">后台运行效果受设备系统管理影响。开启后可在聊天中发送消息、切换 App，并检查回复及系统通知。</p>
 </section>;
}
