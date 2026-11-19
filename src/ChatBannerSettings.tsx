import {useEffect,useState,type CSSProperties} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import {saveChatBanner} from './chatBannerSettings';

const switchStyle=(on:boolean):CSSProperties=>({position:'relative',width:52,height:32,minWidth:52,borderRadius:20,border:'none',padding:0,background:on?'#34c759':'#d1d5db',transition:'background .2s',cursor:'pointer',flexShrink:0});
const knobStyle=(on:boolean):CSSProperties=>({position:'absolute',top:2,left:on?22:2,width:28,height:28,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px #0003',transition:'left .2s'});

export function ChatBannerSettings(){
 const [enabled,setEnabled]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{
  const sub=liveQuery(()=>db.themes.get('global')).subscribe({
   next:t=>setEnabled(t?.chatMessageBanners!==false),
   error:()=>setError('消息横幅设置读取失败')
  });
  return()=>sub.unsubscribe();
 },[]);
 function toggle(){
  if(saving)return;
  const next=!enabled;
  setEnabled(next);setSaving(true);
  void saveChatBanner(next).then(()=>setError('')).catch(()=>{
   setEnabled(!next);setError('消息横幅设置保存失败');
  }).finally(()=>setSaving(false));
 }
 return <section className="card form" aria-label="聊天消息横幅">
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
   <div>
    <h3 style={{margin:0}}>聊天消息横幅</h3>
    <p className="hint" style={{margin:'6px 0 0'}}>离开对应聊天后，已保存的角色消息显示顶部横幅，不额外调用 AI。</p>
   </div>
   <button type="button" role="switch" aria-label="聊天消息横幅" aria-checked={enabled} disabled={saving} onClick={toggle} style={switchStyle(enabled)}>
    <span style={knobStyle(enabled)}/>
   </button>
  </div>
  {error&&<p role="alert" className="hint" style={{margin:'8px 0 0'}}>{error}</p>}
 </section>;
}
