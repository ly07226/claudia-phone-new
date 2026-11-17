import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import {saveChatBanner} from './chatBannerSettings';
export function ChatBannerSettings(){const [enabled,setEnabled]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);useEffect(()=>{const sub=liveQuery(()=>db.themes.get('global')).subscribe({next:t=>setEnabled(t?.chatMessageBanners!==false),error:()=>setError('消息横幅设置读取失败')});return()=>sub.unsubscribe();},[]);return <div><label>聊天消息横幅<input aria-label="聊天消息横幅" role="switch" type="checkbox" checked={enabled} disabled={saving} onChange={e=>{const next=e.target.checked;setEnabled(next);setSaving(true);void saveChatBanner(next).then(()=>setError('')).catch(()=>{setEnabled(!next);setError('消息横幅设置保存失败');}).finally(()=>setSaving(false));}}/></label><p>离开对应聊天后，已保存的角色消息显示顶部横幅，不额外调用 AI。</p>{error&&<p role="alert">{error}</p>}</div>;}
