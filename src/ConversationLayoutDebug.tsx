import {useEffect,useState} from 'react';
/** Read-only, opt-in conversation geometry overlay. */
export function ConversationLayoutDebug(){
 const enabled=typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('layoutDebug');
 const [report,setReport]=useState('');
 useEffect(()=>{
  if(!enabled)return;
  const measure=()=>{
   const selectors=['.stage.chat-stage','.phone.chat-conversation','.phone.chat-conversation > .app-panel','.phone.chat-conversation > .app-panel > .app-scroll','.chat-app.chat-immersive','.chat-footer','.chat-compose'];
   const lines=selectors.map(s=>{
    const el=document.querySelector<HTMLElement>(s);
    if(!el)return s+': missing';
    const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
    return s.split(' ').at(-1)+': '+Math.round(r.top)+'..'+Math.round(r.bottom)+' h'+Math.round(r.height)+' overflow='+cs.overflowY;
   });
   lines.unshift('inner='+innerHeight+' vv='+Math.round(window.visualViewport?.height||0)+' offset='+Math.round(window.visualViewport?.offsetTop||0)+' screen='+screen.height);
   setReport(lines.join('\n'));
  };
  measure();const id=window.setInterval(measure,500);
  window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
  return()=>{clearInterval(id);window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
 },[enabled]);
 if(!enabled)return null;
 return <aside aria-label="对话布局诊断" style={{position:'fixed',top:'calc(env(safe-area-inset-top) + 8px)',left:8,right:8,zIndex:99999,padding:8,background:'#17251fea',color:'white',fontSize:11,lineHeight:1.45,whiteSpace:'pre-wrap',overflowWrap:'anywhere',pointerEvents:'auto',borderRadius:8}}>
  <strong>角色对话布局诊断（只读）</strong>
  <pre style={{font:'inherit',whiteSpace:'pre-wrap',margin:'6px 0'}}>{report}</pre>
  <button type="button" onClick={()=>{void navigator.clipboard?.writeText(report);}} style={{fontSize:12,padding:'6px 10px'}}>复制坐标</button>
 </aside>;
}
