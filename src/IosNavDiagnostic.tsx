import {useEffect,useState} from 'react';

type Reading={name:string;bottom:number;gap:number;top:number;viewport:number;inner:number;scrollY:number};
function measure():Reading|null{
 const targets=[
  ['聊天底栏',document.querySelector<HTMLElement>('[data-chat-hub] .hub-tabs')],
  ['桌面 Dock',document.querySelector<HTMLElement>('.desktop .dock')],
  ['其他底栏',document.querySelector<HTMLElement>('.app-panel .dock')],
 ] as const;
 const found=targets.find(([,el])=>el&&el.getClientRects().length>0);
 if(!found||!found[1])return null;
 const rect=found[1].getBoundingClientRect();
 const viewport=window.visualViewport?.height??window.innerHeight;
 const offset=window.visualViewport?.offsetTop??0;
 return {name:found[0],bottom:rect.bottom,top:rect.top,gap:viewport+offset-rect.bottom,viewport,inner:window.innerHeight,scrollY:window.scrollY};
}
const fmt=(n:number)=>Number.isFinite(n)?n.toFixed(1):'—';
export function IosNavDiagnostic(){
 const [first,setFirst]=useState<Reading|null>(null);
 const [after,setAfter]=useState<Reading|null>(null);
 const [stage,setStage]=useState('等待首次测量');
 useEffect(()=>{
  if(!/iPad|iPhone|iPod/.test(navigator.userAgent))return;
  let timer=0,initial=0;
  const snapshot=()=>{
   const m=measure();if(!m)return;
   setFirst(prev=>prev??m);setStage('首次测量完成，手动滑动一次');
  };
  const capture=()=>{
   window.clearTimeout(timer);
   timer=window.setTimeout(()=>{
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
     const m=measure();if(m){setAfter(m);setStage('已记录滑动后位置');}
    }));
   },250);
  };
  const start=()=>{initial=Date.now();};
  const end=()=>{if(Date.now()-initial<3000)capture();};
  window.addEventListener('touchstart',start,{passive:true});
  window.addEventListener('touchend',end,{passive:true});
  document.addEventListener('scroll',capture,true);
  const initialTimer=window.setTimeout(snapshot,650);
  return ()=>{window.clearTimeout(initialTimer);window.clearTimeout(timer);window.removeEventListener('touchstart',start);window.removeEventListener('touchend',end);document.removeEventListener('scroll',capture,true);};
 },[]);
 const delta=first&&after&&first.name===after.name?after.bottom-first.bottom:null;
 return <aside aria-label="底部导航位置诊断" style={{position:'fixed',zIndex:2147483646,top:'calc(env(safe-area-inset-top, 0px) + 6px)',right:6,width:228,maxWidth:'65vw',padding:'8px 10px',borderRadius:10,background:'rgba(15,29,25,.92)',color:'#fff',fontSize:11,lineHeight:1.45,pointerEvents:'none',boxShadow:'0 2px 12px #0004'}}>
  <strong>底栏诊断 · 仅测试版</strong><div>{stage}</div>
  <div>首次：{first?first.name:'未找到底栏'} 底边 {first?fmt(first.bottom):'—'}px</div>
  <div>首次距屏底：{first?fmt(first.gap):'—'}px</div>
  <div>滑动后：{after?after.name+' '+fmt(after.bottom)+'px':'等待滑动'}</div>
  <div>滑动后距屏底：{after?fmt(after.gap):'—'}px</div>
  <div>底栏移动：{delta===null?'—':fmt(delta)+'px'}</div>
  <div>视口：{after?fmt(after.viewport):first?fmt(first.viewport):'—'} / inner {after?fmt(after.inner):first?fmt(first.inner):'—'}</div>
 </aside>;
}
