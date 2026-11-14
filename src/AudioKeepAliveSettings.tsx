import {useEffect,useRef,useState} from 'react';

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
export function AudioKeepAliveSettings(){
 const [enabled,setEnabled]=useState(()=>{try{return localStorage.getItem(STORAGE_KEY)==='true';}catch{return false;}});
 const [playing,setPlaying]=useState(false);
 const [resumeNotice,setResumeNotice]=useState('');
 const [backgrounded,setBackgrounded]=useState(()=>document.visibilityState==='hidden');
 const [error,setError]=useState('');
 const audioRef=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{
  const audio=player();audioRef.current=audio;
  const sync=()=>setPlaying(!audio.paused&&!audio.ended);
  audio.addEventListener('play',sync);audio.addEventListener('pause',sync);audio.addEventListener('ended',sync);
  const resume=()=>{
   setBackgrounded(document.visibilityState==='hidden');sync();
   // Only resume a user-enabled session. Never start playback for new users.
   let enabled=false;try{enabled=localStorage.getItem(STORAGE_KEY)==='true';}catch{}if(!enabled||!audio.paused)return;
   void audio.play().then(()=>{setResumeNotice('');setError('');sync();}).catch(()=>{
    setResumeNotice('系统已暂停音频；请点击「开启后台保活」手动恢复。');sync();
   });
  };
  const onVisible=()=>{if(document.visibilityState==='visible')resume();else {setBackgrounded(true);sync();}};
  const onPageShow=()=>resume();
  const onAudioError=()=>{sync();setError('音频播放发生错误，请点击开启重新尝试。');};
  audio.addEventListener('error',onAudioError);
  window.addEventListener('pageshow',onPageShow);
  document.addEventListener('visibilitychange',onVisible);
  // Do not autoplay on mount: iOS requires an explicit user gesture.
  return()=>{audio.removeEventListener('play',sync);audio.removeEventListener('pause',sync);
   audio.removeEventListener('ended',sync);audio.removeEventListener('error',onAudioError);
   document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('pageshow',onPageShow);};
 },[]);
 async function toggle(){
  const audio=audioRef.current??player();
  if(playing){audio.pause();audio.currentTime=0;setEnabled(false);setPlaying(false);setError('');setResumeNotice('');
   try{localStorage.removeItem(STORAGE_KEY);}catch{}return;}
  try{await audio.play();setEnabled(true);setPlaying(true);setError('');setResumeNotice('');
   try{localStorage.setItem(STORAGE_KEY,'true');}catch{}}
  catch(e){setEnabled(false);setPlaying(false);setError(e instanceof Error?e.message:'音频启动失败，请在页面内点击重试。');}
 }
 return <section className="card form" aria-label="后台音频保活">
  <h3>后台保活（实验性）</h3>
  <p className="hint">播放 30 秒无声循环音频，尝试延长 iPhone 切出小手机后的运行时间。不保证后台定时器、网络或 AI 回复持续执行，也不等于离线推送。</p>
  <button type="button" className="list-row" onClick={()=>void toggle()} aria-pressed={playing}>
   <span>{playing?'停止后台保活':'开启后台保活'}</span><span>{playing?'播放中':enabled?'已中断':'关闭'}</span>
  </button>
  {enabled&&!playing&&<p role="status">音频已中断，点击开启以重新启动。</p>}
  {playing&&<p role="status">{backgrounded?'后台播放状态：音频尚在播放（网页恢复后才能核实是否持续）':'无声音频正在播放。切换 App 或锁屏后返回这里，可检查是否被系统暂停。'}</p>}
  {resumeNotice&&<p role="status">{resumeNotice}</p>}
  {error&&<p role="alert">{error}</p>}
  <p className="hint">可能增加耗电、占用媒体控制中心或干扰其他音频。iOS 可能随时暂停网页；建议在锁屏及切换 App 后实际测试。</p>
 </section>;
}
