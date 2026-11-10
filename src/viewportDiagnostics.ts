/** Opt-in geometry only. No message text, field values, images, credentials or network requests. */
const flag='claudia.viewportDiagnostics.v1';
const targets:Record<string,string>={html:'html',body:'body',root:'#root',stage:'.stage',phone:'.phone',status:'.phone>.status',appPanel:'.phone>.app-panel',header:'.phone>.app-panel>header',appScroll:'.phone>.app-panel>.app-scroll',hub:'[data-chat-hub]',panes:'.hub-panes',page:'[data-chat-hub] [role=tabpanel]:not([hidden])',navigation:'.hub-tabs',conversation:'.chat-immersive',messages:'.chat-history',footer:'.chat-footer'};
const properties=['display','box-sizing','height','min-height','max-height','width','position','top','bottom','transform','translate','scale','contain','content-visibility','perspective','filter','backdrop-filter','overflow','overflow-x','overflow-y','padding-top','padding-bottom','margin-top','margin-bottom','flex','flex-direction','flex-grow','flex-shrink','flex-basis','align-items','justify-content','gap','background-color','zoom','isolation','z-index'];
const variables=['--safe-top','--safe-bottom','--status-height','--chat-height','--chat-top','--chat-shell-height'];
export interface ViewportDiagnosticRecord {sequence:number;event:string;time:number;data:ReturnType<typeof measure>}
let state:{enabled:boolean;records:readonly ViewportDiagnosticRecord[];paused:boolean;storageAvailable:boolean}={enabled:false,records:[],paused:false,storageAvailable:true};
let stop:(()=>void)|undefined,sequence=0,firstNavigation:ViewportDiagnosticRecord|undefined;
let launch:ViewportDiagnosticRecord|undefined,preScroll:ViewportDiagnosticRecord|undefined,firstScroll:ViewportDiagnosticRecord|undefined;
let decisions:Record<string,number|string|boolean>[]=[];
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(f=>f());
export const subscribeViewportDiagnostics=(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};};
export const getViewportDiagnostics=()=>state;
export function noteViewportDecision(frame:Record<string,number|string|boolean>){if(state.enabled&&!state.paused)decisions=[...decisions.slice(-7),frame];}
function label(el:Element){for(const [key,selector] of Object.entries(targets))if(el.matches(selector))return key;return el.tagName.toLowerCase();}
const computedValue=(v:string)=>/url\(|https?:|data:|authorization|bearer|sk-/i.test(v)?'[resource-or-sensitive-value]':v.slice(0,180);
const value=(v:string)=>!v?'':/^(?:-?[\d.]+(?:px|%|vh|dvh|svh)?|auto|none)$/.test(v.trim())?v.trim():'[expression]';
function element(el:Element){const r=el.getBoundingClientRect(),s=getComputedStyle(el),h=el as HTMLElement;return {node:label(el),fixedContainingBlockSignals:{transform:s.transform!=='none',perspective:s.perspective!=='none',filter:s.filter!=='none',contain:/paint|layout|strict|content/.test(s.contain),willChange:/transform|filter|perspective/.test(s.willChange)},rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height},clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,computed:Object.fromEntries(properties.map(k=>[k,computedValue(s.getPropertyValue(k))])),variables:Object.fromEntries(variables.map(k=>[k,value(s.getPropertyValue(k))])),inline:Object.fromEntries(['height','min-height','max-height','top','bottom','padding-bottom',...variables].map(k=>[k,value(h.style?.getPropertyValue(k)??'')]))};}
function measure(){
 const vv=visualViewport,nav=document.querySelector('.hub-tabs'),ancestors:ReturnType<typeof element>[]=[],seen=new Set<Element>();let p:Element|null=nav;
 while(p){ancestors.push(element(p));seen.add(p);p=p.parentElement;}
 const nodes=Object.fromEntries(Object.entries(targets).map(([k,selector])=>{const el=document.querySelector(selector);return [k,el?element(el):null];}));
 const bottom=(vv?.offsetTop??0)+(vv?.height??innerHeight),navBottom=nav?.getBoundingClientRect().bottom;
 const points:unknown[]=[];
 if(navBottom!==undefined&&bottom>navBottom+1){for(const fraction of [.1,.5,.9]){const x=(vv?.offsetLeft??0)+(vv?.width??innerWidth)*.5,y=navBottom+(bottom-navBottom)*fraction;points.push({x,y,layers:document.elementsFromPoint(x,y).filter(el=>!el.closest('[data-viewport-diagnostics-ui],[data-viewport-probes]')).slice(0,6).map(element),coveringAncestors:ancestors.filter(a=>a.rect.top<=y&&a.rect.bottom>=y).map(a=>a.node)});}}
 const probes=Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-viewport-probe]')).map(e=>[e.dataset.viewportProbe,{rectHeight:e.getBoundingClientRect().height,computedHeight:getComputedStyle(e).height}]));
 const safe=document.querySelector<HTMLElement>('[data-viewport-env]');
 const module=document.querySelector<HTMLScriptElement>('script[type=module][src]');let build='development-or-unknown';try{const path=new URL(module?.src??'',location.origin).pathname;if(/^\/assets\/[\w.-]+\.js$/.test(path))build=path;}catch{}
 return {build,support:{dvh:CSS.supports('height','100dvh'),svh:CSS.supports('height','100svh'),has:CSS.supports('selector(:has(*))')},readyState:document.readyState,visibility:document.visibilityState,standalone:!!(navigator as Navigator&{standalone?:boolean}).standalone,displayModeStandalone:matchMedia('(display-mode: standalone)').matches,browser:{iosVersion:navigator.userAgent.match(/OS ([\d_]+)/)?.[1]??null,webKitVersion:navigator.userAgent.match(/AppleWebKit\/([\d.]+)/)?.[1]??null,devicePixelRatio},viewport:{innerHeight,innerWidth,clientHeight:document.documentElement.clientHeight,clientWidth:document.documentElement.clientWidth,scrollX,scrollY,visual:vv?{height:vv.height,width:vv.width,offsetTop:vv.offsetTop,offsetLeft:vv.offsetLeft,scale:vv.scale}:null},cssUnits:probes,safeArea:safe?{top:getComputedStyle(safe).paddingTop,bottom:getComputedStyle(safe).paddingBottom}:null,activeElement:document.activeElement?label(document.activeElement):null,nodes,navigationAncestors:ancestors,gap:navBottom===undefined?null:{toVisualBottom:bottom-navBottom,toInnerBottom:innerHeight-navBottom,toClientBottom:document.documentElement.clientHeight-navBottom,hitTests:points},recentDecisions:decisions};
}
export function captureViewportDiagnostic(event='manual'){
 if(!state.enabled||state.paused)return;
 const record:ViewportDiagnosticRecord={sequence:++sequence,event,time:Date.now(),data:measure()};
 if(!launch)launch=record;
 if(!firstNavigation&&record.data.nodes.navigation)firstNavigation=record;
 if(event==='first-scroll'&&!firstScroll)firstScroll=record;
 const recent=[...state.records.filter(r=>r!==firstNavigation),record].slice(-19);
 state={...state,records:firstNavigation&&!recent.includes(firstNavigation)?[firstNavigation,...recent]:recent};emit();
}
export function exportViewportDiagnostics(){return JSON.stringify({milestones:{launch,firstNavigation,preScroll,firstScroll},format:'claudia-viewport-diagnostics',version:1,privacy:'Geometry only; memory-only records; no chat text, input values, API credentials or image URLs.',records:state.records},null,2);}
/** Bounded geometry summary: no arbitrary CSS strings, text or resource URLs. */
export function exportShortViewportDiagnostics(){
 const n=(v:unknown)=>typeof v==='number'?Math.round(v*10)/10:null;
 const frame=(r:ViewportDiagnosticRecord|undefined)=>{if(!r)return null;const d=r.data;
  const node=(key:string)=>{const e=d.nodes[key];return e?[n(e.rect.height),n(e.rect.bottom),e.inline.height,e.inline['--chat-shell-height']]:null;};
  return {t:r.time,event:r.event,ih:n(d.viewport.innerHeight),vv:[n(d.viewport.visual?.height),n(d.viewport.visual?.offsetTop)],ch:n(d.viewport.clientHeight),root:node('root'),hub:node('hub'),nav:n(d.nodes.navigation?.rect.bottom),gap:n(d.gap?.toVisualBottom),safe:d.safeArea?.bottom,inline:[d.nodes.phone?.inline.height,d.nodes.appScroll?.inline.height,d.nodes.hub?.inline['--chat-shell-height']]};
 };
 const report={v:2,mode:launch?.data.standalone||launch?.data.displayModeStandalone?'standalone':'browser',legend:'root/hub=[高,底,内联高,内联shell高];gap=可视底减导航底(含安全区);时间=毫秒',launch:frame(launch),first:frame(firstNavigation),before:frame(preScroll),after:frame(firstScroll),latest:frame(state.records.at(-1))};
 // Bound the entire string, not just CJK characters. Milestones remain in full export.
 let text=JSON.stringify(report);if(text.length>1200)text=JSON.stringify({...report,latest:undefined});
 if(text.length>1200)text=JSON.stringify({...report,launch:undefined,latest:undefined});
 if(text.length>1200){
  const compact=(r:ViewportDiagnosticRecord|undefined)=>{const f=frame(r);return f?[f.t,f.event,f.ih,f.vv,f.ch,f.root,f.hub,f.nav,f.gap,f.safe,f.inline]:null;};
  text=JSON.stringify({v:2,keys:'时间,事件,innerHeight,vv高/偏移,clientHeight,root高/底/内联,hub高/底/内联,nav底,gap,safe,inline',first:compact(firstNavigation),before:compact(preScroll),after:compact(firstScroll)});
 }
 return text;
}
function install(){
 const probes=document.createElement('div');probes.dataset.viewportProbes='';probes.setAttribute('aria-hidden','true');
 for(const unit of ['vh','svh','dvh']){const e=document.createElement('div');e.dataset.viewportProbe=unit;e.style.cssText=`position:fixed;top:0;left:0;width:0;height:100${unit};visibility:hidden;pointer-events:none;padding:0;margin:0;border:0;min-height:0;max-height:none`;probes.append(e);}
 const safe=document.createElement('div');safe.dataset.viewportEnv='';safe.style.cssText='position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';probes.append(safe);document.body.append(probes);
 let timer=0,frame=0,last=0;
 const schedule=(event:string)=>{if(state.paused||timer||frame)return;timer=window.setTimeout(()=>{timer=0;frame=requestAnimationFrame(()=>{frame=0;if(!state.enabled||state.paused)return;last=performance.now();captureViewportDiagnostic(event);});},Math.max(0,200-(performance.now()-last)));};
 const events=['resize','orientationchange','pageshow','pagehide','focusin','focusout','visibilitychange','scroll','touchstart'];
 const event=(e:Event)=>{if(e.target instanceof Element&&e.target.closest('[data-viewport-diagnostics-ui],[data-viewport-probes]'))return;
  if(e.type==='touchstart'&&!firstScroll&&!state.paused&&document.querySelector('.hub-tabs'))captureViewportDiagnostic('before-first-gesture');
  if(e.type==='scroll'&&e.target!==visualViewport&&!firstScroll&&!state.paused&&document.querySelector('.hub-tabs')){
   // The pre-scroll record is already cached; reading here would only see the repaired layout.
   preScroll=state.records.filter(r=>r.data.nodes.navigation).at(-1)??firstNavigation;
   captureViewportDiagnostic('first-scroll');
  }
  schedule(e.type);
 };
 events.forEach(t=>window.addEventListener(t,event,true));visualViewport?.addEventListener('resize',event);visualViewport?.addEventListener('scroll',event);
 const observer=new MutationObserver(rows=>{if(rows.some(r=>!(r.target instanceof Element&&r.target.closest('[data-viewport-diagnostics-ui],[data-viewport-probes]'))&&!(r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(n=>n instanceof Element&&n.matches('[data-viewport-diagnostics-ui],[data-viewport-probes]'))))) {if(!firstNavigation&&document.querySelector('.hub-tabs'))captureViewportDiagnostic('first-navigation-layout');else schedule('layout-mutation');}});
 observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','data-standalone','data-ios','data-chat-keyboard']});
 captureViewportDiagnostic('enabled-or-launch');
 return()=>{clearTimeout(timer);cancelAnimationFrame(frame);observer.disconnect();events.forEach(t=>window.removeEventListener(t,event,true));visualViewport?.removeEventListener('resize',event);visualViewport?.removeEventListener('scroll',event);probes.remove();};
}
export function enableViewportDiagnostics(){if(state.enabled)return;let storageAvailable=true;try{localStorage.setItem(flag,'1');}catch{storageAvailable=false;}state={...state,enabled:true,storageAvailable};stop=install();emit();}
export function initializeViewportDiagnostics(){try{const query=new URLSearchParams(location.search).get('viewportDiagnostics');if(query==='0'){disableViewportDiagnostics();return;}if(query==='1'||localStorage.getItem(flag)==='1')enableViewportDiagnostics();}catch{/* Diagnostic opt-in is optional; normal app operation is unchanged. */}}
export function pauseViewportDiagnostics(paused:boolean){state={...state,paused};emit();}
export function disableViewportDiagnostics(){stop?.();stop=undefined;decisions=[];firstNavigation=undefined;launch=undefined;preScroll=undefined;firstScroll=undefined;state={enabled:false,records:[],paused:false,storageAvailable:true};try{localStorage.removeItem(flag);}catch{}emit();}
