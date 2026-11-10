import {useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {captureViewportDiagnostic,disableViewportDiagnostics,exportViewportDiagnostics,getViewportDiagnostics,initializeViewportDiagnostics,pauseViewportDiagnostics,subscribeViewportDiagnostics} from './viewportDiagnostics';
export function ViewportDiagnosticsPanel(){
 const state=useSyncExternalStore(subscribeViewportDiagnostics,getViewportDiagnostics),[open,setOpen]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{initializeViewportDiagnostics();},[]);
 if(!state.enabled)return null;
 const show=()=>{captureViewportDiagnostic('manual-before-panel');pauseViewportDiagnostics(true);setOpen(true);};
 const close=()=>{setOpen(false);pauseViewportDiagnostics(false);};
 const copy=async()=>{try{await navigator.clipboard.writeText(exportViewportDiagnostics());setNotice('诊断已复制');}catch{setNotice('无法直接复制，请打开记录后长按文本全选复制。');}};
 const button={minHeight:40,padding:'6px 10px',border:'1px solid var(--theme-border,#aaa)',borderRadius:8,fontSize:12,background:'var(--theme-card,#fff)',color:'var(--theme-text,#233)'};
 return createPortal(<div data-viewport-diagnostics-ui style={{position:'fixed',top:'max(8px, env(safe-area-inset-top, 0px))',right:8,zIndex:2147482000,maxWidth:'calc(100vw - 16px)',fontSize:12,color:'var(--theme-text,#233)'}}>
 <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}><button style={button} onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()} onClick={()=>{captureViewportDiagnostic('manual-copy');void copy();}}>采样并复制</button><button style={button} onClick={show}>视口诊断 · {state.records.length}</button></div>
 {notice&&<p role="status" style={{background:'var(--theme-card,#fff)',margin:0,padding:6}}>{notice}</p>}
 {open&&<section role="dialog" aria-label="临时视口诊断" style={{background:'var(--theme-card,#fff)',padding:12,border:'1px solid var(--theme-border,#aaa)',borderRadius:12,width:'min(420px,calc(100vw - 16px))',maxHeight:'70dvh',overflow:'auto'}}><strong>临时视口诊断（只读）</strong><p>打开面板时暂停采集。关闭后复现空白，再点“采样并复制”。不包含消息、输入内容或 API 密钥，不自动上传。</p>{!state.storageAvailable&&<p>浏览器不允许保存开启标记，重新启动后需再次开启。</p>}<textarea aria-label="可复制的视口诊断" readOnly value={exportViewportDiagnostics()} style={{width:'100%',height:'30dvh',fontSize:16,color:'inherit',background:'var(--theme-input,#fff)'}}/><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button style={button} onClick={()=>void copy()}>复制记录</button><button style={button} onClick={close}>关闭面板</button><button style={button} onClick={()=>{setOpen(false);disableViewportDiagnostics();}}>关闭诊断并清空记录</button></div></section>}
 </div>,document.body);
}
