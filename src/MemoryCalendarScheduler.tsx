import {useEffect,useRef,useState} from 'react';
import {db} from './store';
import {getMemoryScope} from './memoryStore';
import {runDailyDigest} from './dailyDigest';
import {dueTimeMemories,acknowledgeTimeMemory,nextOccurrence,type SmartTimeMemory} from './smartTimeMemory';
import type {MemoryScope} from './memoryTypes';
/** Foreground-only scheduler: never promises iOS background delivery. */
export function MemoryCalendarScheduler(){
 const snoozed=useRef(new Set<string>());
 const [notice,setNotice]=useState<{scope:MemoryScope;record:SmartTimeMemory}|null>(null);
 useEffect(()=>{let disposed=false,running=false;
  const scan=async()=>{
   if(disposed||running||document.visibilityState!=='visible'||!navigator.onLine)return;
   running=true;
   try{
    const conversations=await db.conversations.toArray();
    for(const c of conversations){
     if(disposed)break;
     if(!c.dailyDigestSettings?.enabled&&!c.smartTimeMemories?.some(r=>r.enabled))continue;
     let scope:MemoryScope;
     try{scope=await getMemoryScope(c.id);}catch{continue;}
     if(c.dailyDigestSettings?.enabled)void runDailyDigest(scope).catch(()=>{});
     if(!notice&&c.smartTimeMemories?.some(r=>r.enabled)){
      const due=await dueTimeMemories(scope);
      const eligible=due.find(r=>(r.method==='system'||r.method==='both')&&!snoozed.current.has(r.id+':'+nextOccurrence(r)));
      if(eligible&&!disposed){setNotice(previous=>previous??{scope,record:eligible});}
     }
    }
   }finally{running=false;}
  };
  const foreground=()=>void scan();
  document.addEventListener('visibilitychange',foreground);window.addEventListener('focus',foreground);
  const timer=setInterval(foreground,60000);
  void scan();
  return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',foreground);window.removeEventListener('focus',foreground);};
 },[notice?.record.id]);
 if(!notice)return null;
 return <div className="memory-calendar-notice" role="status" style={{position:'fixed',top:'max(16px, env(safe-area-inset-top))',left:'50%',transform:'translateX(-50%)',zIndex:10000,maxWidth:360,width:'calc(100% - 32px)',background:'var(--surface-color,#f6f6f6)',color:'var(--text-color,#222)',padding:16,borderRadius:16,boxShadow:'0 8px 30px #0004'}}>
  <strong>智能时间记忆</strong><p>{notice.record.title} · 预计 {nextOccurrence(notice.record)}</p>
  {notice.record.category==='period'&&<small>这是根据记录估算的日期，实际可能不同。</small>}
  <div><button type="button" onClick={()=>{void acknowledgeTimeMemory(notice.scope,notice.record.id,nextOccurrence(notice.record)).finally(()=>setNotice(null));}}>知道了</button><button type="button" onClick={()=>{snoozed.current.add(notice.record.id+':'+nextOccurrence(notice.record));setNotice(null);}}>稍后</button></div>
 </div>;
}
