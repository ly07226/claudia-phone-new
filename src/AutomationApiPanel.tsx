import {useEffect,useState} from 'react';
import {db,defaultTheme} from './store';
import {liveQuery} from 'dexie';
import type {ApiConfig} from './api';
import {saveSummaryApi,type DedicatedSummaryApi} from './dedicatedSummaryApi';
export function AutomationApiPanel({configs}:{configs:ApiConfig[]}){
 const [current,setCurrent]=useState<DedicatedSummaryApi|undefined>();
 const [selected,setSelected]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{const sub=liveQuery(()=>db.themes.get('global')).subscribe({next:v=>setCurrent(v?.dedicatedSummaryApi),error:()=>setNotice('读取自动任务配置失败')});return()=>sub.unsubscribe()},[]);
 async function shared(){
  setBusy(true);setNotice('');
  try{await db.transaction('rw',db.themes,async()=>{const global=await db.themes.get('global');if(global?.dedicatedSummaryApi)await db.themes.put({...defaultTheme,...global,id:'global',dedicatedSummaryApi:{...global.dedicatedSummaryApi,enabled:false}})});setNotice('已使用聊天 API')}catch{setNotice('保存失败')}finally{setBusy(false)}
 }
 async function independent(){
  setBusy(true);setNotice('');
  try{
   const c=configs.find(c=>c.id===selected);
   if(!c){if(current){await saveSummaryApi({...current,enabled:true});setNotice('已启用独立 API');return}throw Error('请选择 API 配置')}
   const credential=await db.apiCredentials.get(c.id);
   if(!credential?.apiKey)throw Error('所选配置缺少 Key');
   const value:DedicatedSummaryApi={provider:c.provider as DedicatedSummaryApi['provider'],protocol:c.protocol,baseUrl:c.baseUrl,model:c.model,apiKey:credential.apiKey,temperature:c.temperature,maxTokens:c.maxTokens,contextWindowTokens:c.contextWindowTokens,modelOutputTokens:c.modelOutputTokens,enabled:true};
   await saveSummaryApi(value);setNotice('已保存独立自动任务 API');
  }catch(e){setNotice(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}
 }
 return <section className="card form"><h3>自动任务 API</h3><p>{current?.enabled?'独立接口：'+current.model:'沿用普通聊天 API'}</p><p>记忆、自动朋友圈、主动消息、生活日程及私人记录共用此接口。普通聊天不受此设置影响。</p><label>选择已添加的 API<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={busy}><option value="">{current?'保留现有专用配置':'请选择（可先在下方新增 API）'}</option>{configs.filter(c=>c.enabled).map(c=><option key={c.id} value={c.id}>{c.name} · {c.model}</option>)}</select></label><button type="button" disabled={busy} onClick={()=>void independent()}>启用独立 API</button><button type="button" disabled={busy} onClick={()=>void shared()}>沿用聊天 API</button>{notice&&<p role="status">{notice}</p>}<p>独立配置保存为副本，修改原 API 后可重新选择更新。</p></section>
}
