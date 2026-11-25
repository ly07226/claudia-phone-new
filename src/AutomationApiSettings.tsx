import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import type {ApiConfig} from './api';
import {AutomationApiPanel} from './AutomationApiPanel';

export function AutomationApiSettings(){
 const [configs,setConfigs]=useState<ApiConfig[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{
  const subscription=liveQuery(()=>db.apiConfigs.toCollection().sortBy('createdAt')).subscribe({
   next:setConfigs,
   error:()=>setError('读取 API 配置失败，请检查本地存储')
  });
  return ()=>subscription.unsubscribe();
 },[]);
 return <div className="api-settings">
  <div className="page-title"><span className="eyebrow">AUTOMATION</span><h2>自动任务 API</h2><p>独立配置自动任务，不影响普通聊天。</p></div>
  {error&&<p role="alert">{error}</p>}
  <details className="card">
   <summary>展开自动任务 API 设置</summary>
   <AutomationApiPanel configs={configs}/>
  </details>
 </div>;
}
