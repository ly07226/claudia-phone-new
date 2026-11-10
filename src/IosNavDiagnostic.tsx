import {useEffect,useState} from 'react';
type Reading={name:string;bottom:number;top:number;height:number;gap:number;viewport:number;inner:number;safe:number;paddingBottom:number;scrollY:number;shell:number;standalone:boolean;inputBottom:number|null};
function measure():Reading|null{
 const targets:[string,string][]=[['聊天底栏','[data-chat-hub] .hub-tabs'],['角色输入区','.chat-conversation .chat-composer'],['角色输入区','.chat-conversation form'],['桌面 Dock','.desktop .dock']];
 const found=targets.map(([name,selector])=>({name,el:document.querySelector<HTMLElement>(selector)})).find(x=>x.el&&x.el.getClientRects().length>0);
 if(!found?.el)return null;
 const el=found.el,rect=el.getBoundingClientRect(),viewport=window.visualViewport?.height??window.innerHeight,offset=window.visualViewport?.offsetTop??0;
 const probe=document.createElement('div');probe.style.cssText='position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom, 0px)';document.body.appendChild(probe);const safe=parseFloat(getComputedStyle(probe).paddingBottom)||0;probe.remove();
 const shell=document.querySelector<HTMLElement>('.stage > .phone')?.getBoundingClientRect().height??0;
 const input=document.querySelector<HTMLElement>('.chat-conversation textarea, .chat-conversation input');
 return {name:found.name,top:rect.top,bottom:rect.bottom,height:rect.height,gap:viewport+offset-rect.bottom,viewport,inner:window.innerHeight,safe,paddingBottom:parseFloat(getComputedStyle(el).paddingBottom)||0,scrollY:window.scrollY,shell,standalone:matchMedia('(display-mode: standalone)').matches||('standalone' in navigator&&Boolean((navigator as Navigator&{standalone?:boolean}).standalone)),inputBottom:input?.getBoundingClientRect().bottom??null};
}
const fmt=(v:number|null|undefined)=>v==null?'—':v.toFixed(1);
export function IosNavDiagnostic(){
 const [first,setFirst]=useState<Reading|null>(null),[after,setAfter]=useState<Reading|null>(null),[stage,setStage]=useState('等待测量');
 useEffect(()=>{
  if(!/iPad|iPhone|iPod/.test(navigator.userAgent))return;
  let current='',timer=0,interval=0;
  const snapshot=()=>{
   const m=measure();if(!m)return;
   if(m.name!==current){current=m.name;setFirst(m);setAfter(null);setStage('已记录此页面首次位置');}
  };
  const afterSwipe=()=>{
   window.clearTimeout(timer);
   timer=window.setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const m=measure();if(m&&m.name===current){setAfter(m);setStage('已记录滑动后位置');}
   })),250);
  };
  const onTouchEnd=()=>afterSwipe();
  const initial=window.setTimeout(snapshot,400);
  interval=window.setInterval(snapshot,350);
  window.addEventListener('touchend',onTouchEnd,{passive:true});
  return ()=>{clearTimeout(initial);clearTimeout(timer);clearInterval(interval);window.removeEventListener('touchend',onTouchEnd);};
 },[]);
 const delta=first&&after&&first.name===after.name?after.bottom-first.bottom:null;
 return <aside aria-label="底部导航位置诊断" style={{position:'fixed',zIndex:2147483646,top:'calc(env(safe-area-inset-top, 0px) + 6px)',right:6,width:246,maxWidth:'70vw',padding:'8px 10px',borderRadius:10,background:'rgba(15,29,25,.92)',color:'#fff',fontSize:11,lineHeight:1.4,pointerEvents:'none',boxShadow:'0 2px 12px #0004'}}>
  <strong>底栏诊断 v2 · 仅测试版</strong><div>{stage}</div>
  <div>页面：{first?.name??'未找到底栏'} / {first?.standalone?'独立PWA':'浏览器'}</div>
  <div>首次：底边 {fmt(first?.bottom)} / 高 {fmt(first?.height)}</div>
  <div>滑后：底边 {fmt(after?.bottom)} / 高 {fmt(after?.height)}</div>
  <div>底边移动：{fmt(delta)}px</div>
  <div>距视口底：{fmt(first?.gap)} → {fmt(after?.gap)}</div>
  <div>底部安全区：{fmt(first?.safe)} → {fmt(after?.safe)}</div>
  <div>底栏下内边距：{fmt(first?.paddingBottom)} → {fmt(after?.paddingBottom)}</div>
  <div>视口高度：{fmt(first?.viewport)} → {fmt(after?.viewport)}</div>
  <div>inner：{fmt(first?.inner)} → {fmt(after?.inner)}</div>
  <div>手机容器高：{fmt(first?.shell)} → {fmt(after?.shell)}</div>
  {first?.inputBottom!=null&&<div>输入框底边：{fmt(first.inputBottom)} → {fmt(after?.inputBottom)}</div>}
 </aside>;
}
