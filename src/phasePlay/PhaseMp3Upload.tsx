import {useEffect,useRef,useState} from 'react';
const DB='claudia-phase-audio',STORE='tracks',KEY='custom-mp3',LIMIT=30*1024*1024;
function openDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function stored(file?:File|null):Promise<File|undefined>{const db=await openDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,file===undefined?'readonly':'readwrite'),req=file===undefined?tx.objectStore(STORE).get(KEY):file===null?tx.objectStore(STORE).delete(KEY):tx.objectStore(STORE).put(file,KEY);if(file===undefined){req.onsuccess=()=>resolve(req.result instanceof File?req.result:undefined);}else tx.oncomplete=()=>resolve(undefined);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
let activeAudio:HTMLAudioElement|undefined;
let activeUrl:string|undefined;
export async function startPhaseMp3():Promise<boolean>{
 try{
  const file=await stored();
  if(!file)return false;
  stopPhaseMp3();
  activeUrl=URL.createObjectURL(file);
  activeAudio=new Audio(activeUrl);
  activeAudio.loop=true;
  await activeAudio.play();
  return true;
 }catch{stopPhaseMp3();return false;}
}
export function stopPhaseMp3(){
 activeAudio?.pause();activeAudio=undefined;
 if(activeUrl){URL.revokeObjectURL(activeUrl);activeUrl=undefined;}
}
export function PhaseMp3Upload({source,onSourceChange}:{source:'metronome'|'mp3';onSourceChange:(value:'metronome'|'mp3')=>void}){
 const [file,setFile]=useState<File>(),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const audio=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{let active=true;stored().then(v=>{if(active)setFile(v);}).catch(()=>{if(active)setMessage('无法读取本地 MP3。');});return()=>{active=false;};},[]);
 useEffect(()=>{if(!file){setUrl('');return;}const objectUrl=URL.createObjectURL(file);setUrl(objectUrl);return()=>URL.revokeObjectURL(objectUrl);},[file]);
 async function upload(next?:File){if(!next)return;if(!/\.mp3$/i.test(next.name)&&next.type!=='audio/mpeg')return setMessage('请选择 MP3 文件。');if(!next.size||next.size>LIMIT)return setMessage('MP3 文件不得超过 30 MB。');setBusy(true);try{await stored(next);audio.current?.pause();setFile(next);setMessage('已保存到此设备。');}catch{setMessage('保存失败，可能是浏览器空间不足。');}finally{setBusy(false);}}
 async function remove(){setBusy(true);try{await stored(null);audio.current?.pause();setFile(undefined);setMessage('已删除本地 MP3。');}catch{setMessage('删除失败。');}finally{setBusy(false);}}
 return <div className="phase-play-card"><h3>自定义 MP3</h3><p className="phase-play-note">上传本地 MP3（最大 30 MB），仅保存在此浏览器，不上传服务器、不消耗 API。游戏时可选择节拍器或 MP3，两个功能都会保留。</p><label className="phase-play-toggle">使用节拍器<input type="radio" name="phase-audio-source" checked={source==='metronome'} onChange={()=>onSourceChange('metronome')}/></label>
 <label className="phase-play-toggle">使用 MP3<input type="radio" name="phase-audio-source" checked={source==='mp3'} onChange={()=>onSourceChange('mp3')}/></label>
 <label>上传 MP3<input type="file" aria-label="上传 MP3" accept=".mp3,audio/mpeg" disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>{file&&<><p className="phase-play-note">{file.name}</p>{url&&<audio ref={audio} controls src={url} preload="none" style={{width:'100%'}} aria-label="MP3 播放器"/>}<button type="button" disabled={busy} onClick={()=>void remove()}>删除 MP3</button></>}{message&&<p role="status">{message}</p>}</div>;
}
