import {useEffect,useRef,useState} from 'react';
import {storyLengths,type StoryLength} from './storyTypes';
import {prepareImage,attachmentError} from './imageAttachments';
import {storyReadingColors,storyReadingStyle,type StoryReadingPreferences} from './storyReadingPreferences';
import './storyReadingSettings.css';
export function StorySettingsPage({preferences:p,loaded,saving,error,busy,length,onChange,onLength,onRefresh,onBack}:{preferences:StoryReadingPreferences;loaded:boolean;saving:boolean;error:string;busy:boolean;length:StoryLength;onChange:(patch:Partial<StoryReadingPreferences>|null)=>void;onLength:(length:StoryLength)=>Promise<void>;onRefresh:()=>void;onBack:()=>void}){
 const heading=useRef<HTMLHeadingElement>(null),file=useRef<HTMLInputElement>(null),upload=useRef(0),[imageBusy,setImageBusy]=useState(false),[localError,setLocalError]=useState(''),[notice,setNotice]=useState(''),[lengthBusy,setLengthBusy]=useState(false),[refreshed,setRefreshed]=useState(false);
 useEffect(()=>{heading.current?.focus({preventScroll:true});return()=>{upload.current++;};},[]);
 async function selectImage(f?:File){if(!f)return;const ticket=++upload.current;setImageBusy(true);setLocalError('');setNotice('');try{const image=await prepareImage(f);if(ticket===upload.current){onChange({background:image.data});setNotice(image.notice);}}catch(e){if(ticket===upload.current)setLocalError(attachmentError(e));}finally{if(ticket===upload.current)setImageBusy(false);}}
 function reset(){upload.current++;setImageBusy(false);setNotice('');setLocalError('');onChange(null);}
 return <section className="story-settings-page" aria-label="剧本设置页面"><header><button onClick={onBack} aria-label="返回剧本阅读">‹ 返回</button><h1 ref={heading} tabIndex={-1}>剧本设置</h1></header><div className="story-settings-scroll">
  {(error||localError)&&<p role="alert">{localError||error}</p>}{!loaded&&<p role="status">正在读取阅读设置…</p>}
  <fieldset disabled={!loaded}><legend>阅读排版</legend>
   <label>字体大小 <output>{p.fontSize}px</output><input aria-label="字体大小" type="range" min="13" max="26" step="1" value={p.fontSize} onChange={e=>onChange({fontSize:Number(e.target.value)})}/></label>
   <label>行间距 <output>{p.lineHeight} 倍</output><input aria-label="行间距" type="range" min="1.2" max="2.5" step="0.1" value={p.lineHeight} onChange={e=>onChange({lineHeight:Number(e.target.value)})}/></label>
   <label>页边距 <output>{p.margin}px</output><input aria-label="页边距" type="range" min="8" max="40" step="2" value={p.margin} onChange={e=>onChange({margin:Number(e.target.value)})}/></label>
   <span>字体颜色{!p.color&&' · 跟随主题'}</span><div className="story-reading-swatches" role="group" aria-label="字体颜色">{storyReadingColors.map(c=><button key={c.value} aria-label={c.name} aria-pressed={p.color===c.value} onClick={()=>onChange({color:c.value})}><i style={{background:c.value}} aria-hidden="true"/>{c.name}{p.color===c.value?' ✓':''}</button>)}</div>
  </fieldset>
  <fieldset disabled={!loaded}><legend>阅读背景</legend><p>图片仅保存在本机。支持 JPEG、PNG、WebP，原图上限 15MB；必要时压缩并提示。请注意背景与文字的对比度。</p>
   <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="选择阅读背景图片" hidden onChange={e=>{void selectImage(e.target.files?.[0]);e.target.value='';}}/>
   <div className="story-settings-buttons"><button disabled={imageBusy} onClick={()=>file.current?.click()}>{imageBusy?'正在处理图片…':p.background?'更换背景图片':'选择背景图片'}</button><button disabled={!p.background||imageBusy} onClick={()=>{upload.current++;onChange({background:undefined});setNotice('');}}>移除背景图片</button></div>
   <label>图片适配模式<select aria-label="图片适配模式" value={p.fit??'contain'} onChange={e=>onChange({fit:e.target.value as 'contain'|'cover'})}><option value="contain">完整显示</option><option value="cover">铺满裁切</option></select></label>
   {notice&&<p role="status">{notice}</p>}<label>背景图片透明度 <output>{p.opacity}%</output><input aria-label="背景图片透明度" type="range" min="0" max="100" step="5" disabled={!p.background} value={p.opacity} onChange={e=>onChange({opacity:Number(e.target.value)})}/></label>
  </fieldset>
  <section aria-label="效果预览"><h2>效果预览</h2><div className="story-reading-surface story-reading-preview story-reading-card" style={storyReadingStyle(p)}><div className="story-prose"><p className="story-paragraph">晨光穿过窗帘，落在桌边。你翻开书页，故事在此刻继续。</p><p className="story-paragraph">街道渐渐热闹起来。远处传来轻轻的脚步声，一封尚未拆开的信静静躺在手边。</p></div></div></section>
  <fieldset><legend>剧情设置</legend><label>剧情篇幅<select aria-label="剧情篇幅" value={length} disabled={busy||lengthBusy} onChange={async e=>{setLengthBusy(true);setLocalError('');try{await onLength(e.target.value as StoryLength);}catch{setLocalError('篇幅未保存，原设置保留。');}finally{setLengthBusy(false);}}}>{Object.entries(storyLengths).map(([k,v])=><option key={k} value={k}>{v.label} · 约 {v.target} 字</option>)}</select></label><button disabled={busy||lengthBusy} onClick={()=>{onRefresh();setRefreshed(true);}}>刷新主线状态</button>{refreshed&&<p role="status">已刷新主线状态，未重新生成剧情。</p>}</fieldset>
  <button disabled={!loaded} onClick={reset}>恢复默认</button><p role="status">{saving?'正在保存阅读设置…':'设置自动保存在本机，仅作用于 Story 阅读器。'}</p>
 </div></section>;
}
