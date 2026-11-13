import {storyGenerationNotice} from './storyDirectives';
import {useEffect,useRef,useState} from 'react';
import {storyLengths,type StoryGuidance,type StoryLength} from './storyTypes';
export function StoryControls({kind,guidance,length,busy,availableHeight,onClose,onSave,onLength,onRefresh}:{kind:'settings'|'guidance';guidance?:StoryGuidance;length:StoryLength;busy:boolean;availableHeight:number;onClose:()=>void;onSave:(value:Omit<StoryGuidance,'revision'>,expected:number)=>Promise<unknown>;onLength:(value:StoryLength)=>Promise<void>;onRefresh:()=>void}){
 const [baseRevision]=useState(guidance?.revision??0);
 const box=useRef<HTMLDivElement>(null),lock=useRef(false),[text,setText]=useState(guidance?.text??''),[mode,setMode]=useState<'once'|'persistent'>(guidance?.mode??'once'),[enabled,setEnabled]=useState(guidance?.enabled??true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const previous=document.activeElement;box.current?.focus({preventScroll:true});return()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};},[]);
 async function save(){if(lock.current||busy)return;lock.current=true;setSaving(true);setError('');try{await onSave({text,mode,enabled},baseRevision);onClose();}catch(e){setError(e instanceof Error?e.message:'保存未完成，输入仍保留。');}finally{lock.current=false;setSaving(false);}}
 return <div className="story-control-overlay" onClick={e=>{if(e.target===e.currentTarget&&!saving){e.stopPropagation();onClose();}}}><div ref={box} role="dialog" aria-modal="true" aria-labelledby="story-control-title" className="story-control-dialog" tabIndex={-1} style={{maxHeight:Math.max(100,availableHeight-24)}} onKeyDown={e=>{
  if(e.key==='Escape'&&!saving){e.preventDefault();onClose();}
  if(e.key==='Tab'){const controls=Array.from(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')??[]),first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===box.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===box.current)){e.preventDefault();first?.focus();}}
 }}>
  <h2 id="story-control-title">{kind==='settings'?'剧本设置':'剧情指导'}</h2>
  {kind==='settings'?<><label className="story-length">剧情篇幅<select aria-label="剧情篇幅" value={length} disabled={busy||saving} onChange={async e=>{setSaving(true);setError('');try{await onLength(e.target.value as StoryLength);}catch{setError('篇幅未保存，原设置保留。');}finally{setSaving(false);}}}>{Object.entries(storyLengths).map(([key,value])=><option key={key} value={key}>{value.label} · 约 {value.target} 字</option>)}</select></label><button disabled={busy||saving} onClick={()=>{onRefresh();onClose();}}>刷新主线状态</button></>:<>
   <label>指导内容<textarea aria-label="剧情指导内容" maxLength={2000} rows={5} value={text} disabled={busy||saving} onChange={e=>setText(e.target.value)} placeholder="例如：放慢节奏，通过对白逐步揭示线索。"/></label>
   <label>有效范围<select aria-label="指导有效范围" value={mode} disabled={busy||saving} onChange={e=>setMode(e.target.value as 'once'|'persistent')}><option value="once">仅下一次有效</option><option value="persistent">持续有效</option></select></label>
   <label className="story-guidance-enabled"><input type="checkbox" aria-label="启用剧情指导" checked={enabled} disabled={busy||saving} onChange={e=>setEnabled(e.target.checked)}/>启用指导</label>
   <p className="story-cost">仅当前剧本生效。单次指导在下一次成功生成后停用，失败保留；持续指导可在此编辑或关闭。指导优先于AI默认文风，但不能覆盖世界规则、人物设定或已确认事实。{storyGenerationNotice}</p>
  </>}
  {error&&<p role="alert">{error}</p>}
  <div className="story-control-actions"><button disabled={saving} onClick={onClose}>{kind==='guidance'?'取消':'关闭'}</button>{kind==='guidance'&&<button className="primary" disabled={busy||saving||enabled&&!text.trim()} onClick={()=>void save()}>{saving?'正在保存…':'保存指导'}</button>}</div>
 </div></div>;
}
