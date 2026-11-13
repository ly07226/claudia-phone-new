import {useEffect,useRef,useState} from 'react';
import {db} from '../store';

const DB='claudia-phase-audio',STORE='tracks',LIMIT=40*1024*1024,PREFIX='track:',LEGACY='custom-mp3';
type Track={id:string;file:File};
const selectedKey=()=> 'claudia.phasePlay.selectedMp3:'+db.name;

function openDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transact<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore,resolve:(v:T)=>void,reject:(e:unknown)=>void)=>void):Promise<T>{
 const database=await openDb();
 try{return await new Promise<T>((resolve,reject)=>{const tx=database.transaction(STORE,mode);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);action(tx.objectStore(STORE),resolve,reject);});}
 finally{database.close();}
}
async function tracks():Promise<Track[]>{
 return transact('readonly',(store,resolve,reject)=>{
  const request=store.getAllKeys();
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const keys=request.result.filter((k):k is string=>typeof k==='string'&&k.startsWith(PREFIX));
   if(!keys.length){resolve([]);return;}
   const result:Track[]=[];let remaining=keys.length;
   keys.forEach(key=>{const req=store.get(key);req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(req.result instanceof File)result.push({id:key.slice(PREFIX.length),file:req.result});if(!--remaining)resolve(result.sort((a,b)=>a.id.localeCompare(b.id)));};});
  };
 });
}
async function migrateLegacy():Promise<void>{
 await transact<void>('readwrite',(store,resolve,reject)=>{
  const request=store.get(LEGACY);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   if(!(request.result instanceof File)){resolve();return;}
   const file=request.result as File,id='legacy';
   const put=store.put(file,PREFIX+id);
   put.onerror=()=>reject(put.error);
   put.onsuccess=()=>{const del=store.delete(LEGACY);del.onerror=()=>reject(del.error);del.onsuccess=()=>resolve();};
  };
 });
}
async function save(file:File,id:string):Promise<void>{return transact('readwrite',(store,resolve,reject)=>{const req=store.put(file,PREFIX+id);req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve();});}
async function erase(id:string):Promise<void>{return transact('readwrite',(store,resolve,reject)=>{const req=store.delete(PREFIX+id);req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve();});}
async function selectedTrack():Promise<File|undefined>{
 await migrateLegacy();
 const list=await tracks(),id=localStorage.getItem(selectedKey());
 return (list.find(t=>t.id===id)??list[0])?.file;
}
let activeAudio:HTMLAudioElement|undefined,activeUrl:string|undefined;
export async function startPhaseMp3():Promise<boolean>{
 try{
  const file=await selectedTrack();if(!file)return false;
  stopPhaseMp3();activeUrl=URL.createObjectURL(file);activeAudio=new Audio(activeUrl);activeAudio.loop=true;
  await activeAudio.play();return true;
 }catch{stopPhaseMp3();return false;}
}
export function stopPhaseMp3(){activeAudio?.pause();activeAudio=undefined;if(activeUrl){URL.revokeObjectURL(activeUrl);activeUrl=undefined;}}

export function PhaseMp3Upload({source,onSourceChange}:{source:'metronome'|'mp3';onSourceChange:(value:'metronome'|'mp3')=>void}){
 const [items,setItems]=useState<Track[]>([]),[chosen,setChosen]=useState(''),[preview,setPreview]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const audio=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{let alive=true;(async()=>{await migrateLegacy();const list=await tracks();if(!alive)return;setItems(list);const saved=localStorage.getItem(selectedKey());const id=list.some(t=>t.id===saved)?saved??'':list[0]?.id??'';setChosen(id);if(id)localStorage.setItem(selectedKey(),id);})().catch(()=>{if(alive)setMessage('无法读取本地音频库。');});return()=>{alive=false;};},[]);
 useEffect(()=>{const track=items.find(t=>t.id===preview);if(!track){setUrl('');return;}const objectUrl=URL.createObjectURL(track.file);setUrl(objectUrl);return()=>URL.revokeObjectURL(objectUrl);},[preview,items]);
 function choose(id:string){setChosen(id);localStorage.setItem(selectedKey(),id);}
 async function upload(files:FileList|null){
  if(!files?.length)return;
  setBusy(true);setMessage('');let count=0;
  try{
   for(const file of Array.from(files)){
    if((!/\.mp3$/i.test(file.name)&&file.type!=='audio/mpeg')||!file.size||file.size>LIMIT){setMessage('部分文件不是 MP3 或超过 40 MB，已跳过。');continue;}
    const id=crypto.randomUUID();await save(file,id);count++;
    if(!chosen&&count===1)choose(id);
   }
   setItems(await tracks());
   if(count)setMessage('已保存 '+count+' 首 MP3 到此设备。');
  }catch{setMessage('部分文件保存失败，请检查浏览器存储空间。');setItems(await tracks().catch(()=>[]));}
  finally{setBusy(false);}
 }
 async function remove(id:string){
  if(!confirm('删除这首本地 MP3？'))return;
  setBusy(true);
  try{await erase(id);const list=await tracks();setItems(list);if(preview===id){audio.current?.pause();setPreview('');}if(chosen===id){const next=list[0]?.id??'';setChosen(next);if(next)localStorage.setItem(selectedKey(),next);else localStorage.removeItem(selectedKey());}setMessage('音频已删除。');}
  catch{setMessage('删除失败，请重试。');}
  finally{setBusy(false);}
 }
 return <div className="phase-play-card"><h3>自定义音频</h3><p className="phase-play-note">节拍器与 MP3 都会保留，游戏时选择其中一种声音。每首 MP3 最大 40 MB，仅保存在此浏览器。</p>
  <label className="phase-play-toggle">使用节拍器<input type="radio" name="phase-audio-source" checked={source==='metronome'} onChange={()=>onSourceChange('metronome')}/></label>
  <label className="phase-play-toggle">使用自定义 MP3<input type="radio" name="phase-audio-source" checked={source==='mp3'} onChange={()=>onSourceChange('mp3')}/></label>
  <h4>我的音频库 · {items.length} 首</h4>
  {items.map(track=><div key={track.id} className="phase-play-audio-item">
   <label className="phase-play-toggle"><input type="radio" name="phase-selected-track" checked={chosen===track.id} onChange={()=>choose(track.id)}/><span style={{overflowWrap:'anywhere'}}>{track.file.name}{chosen===track.id?' · 游戏使用中':''}</span></label>
   <div className="phase-play-actions"><button type="button" onClick={()=>{audio.current?.pause();setPreview(preview===track.id?'':track.id);}}>{preview===track.id?'收起试听':'试听'}</button><button type="button" disabled={busy} onClick={()=>void remove(track.id)}>删除</button></div>
   {preview===track.id&&url&&<audio ref={audio} controls src={url} preload="none" style={{width:'100%'}} aria-label={'试听 '+track.file.name}/>}
  </div>)}
  <label>添加 MP3<input type="file" multiple aria-label="添加 MP3" accept=".mp3,audio/mpeg" disabled={busy} onChange={e=>{void upload(e.target.files);e.target.value='';}}/></label>
  {message&&<p role="status">{message}</p>}
  <p className="phase-play-note">上传一次即可重复使用。清除网站数据或更换设备可能丢失，当前音频未纳入备份。</p>
 </div>;
}
