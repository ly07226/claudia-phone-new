import {useEffect,useRef,useState} from 'react';
import {liveQuery} from 'dexie';
import {db,defaultTheme,usePhone} from './store';
import {defaultStoryReading,storedStoryReading,validateStoryReading,type StoryReadingPreferences} from './storyReadingPreferences';
/** Existing global settings record; no new table, remote storage or Story mutations. */
export async function saveStoryReading(patch:Partial<StoryReadingPreferences>|null){
 const saved=await db.transaction('rw',db.themes,async()=>{const current=await db.themes.get('global')??defaultTheme;
  const next={...current};if(patch===null)delete next.storyReading;else {next.storyReading={...storedStoryReading(current.storyReading),...patch};validateStoryReading(next.storyReading);}
  await db.themes.put(next);return next;});usePhone.getState().set({theme:saved});return storedStoryReading(saved.storyReading);
}
export function useStoryReading(){
 const [preferences,setPreferences]=useState<StoryReadingPreferences>({...defaultStoryReading}),[error,setError]=useState(''),[saving,setSaving]=useState(false),[loaded,setLoaded]=useState(false);
 const queue=useRef(Promise.resolve()),pending=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;const sub=liveQuery(async()=>storedStoryReading((await db.themes.get('global'))?.storyReading)).subscribe({next:p=>{if(!pending.current)setPreferences(p);setLoaded(true);},error:()=>{setError('无法读取阅读偏好，暂用默认外观；未修改已有数据。');setLoaded(true);}});return()=>{alive.current=false;sub.unsubscribe();};},[]);
 function change(patch:Partial<StoryReadingPreferences>|null){
  setPreferences(p=>patch===null?{...defaultStoryReading}:{...p,...patch});setError('');pending.current++;setSaving(true);
  queue.current=queue.current.then(async()=>{try{await saveStoryReading(patch);}catch{if(alive.current)setError('阅读设置保存失败，请检查本地存储空间并重试；剧情未改变。');}finally{pending.current--;if(!pending.current&&alive.current){try{setPreferences(storedStoryReading((await db.themes.get('global'))?.storyReading));}catch{setError('无法重新读取阅读设置，请稍后重试。');}finally{setSaving(false);}}}});
 }
 return {preferences,change,error,saving,loaded};
}
