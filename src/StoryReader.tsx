import './storyCardOperations.css';
import {storyReadingStyle,defaultStoryReading,type StoryReadingPreferences} from './storyReadingPreferences';
import {resolveStorySegments} from './storySegments';
import {formatStoryProse} from './storyProse';
import {memo,useLayoutEffect,useRef,useState,useMemo,type ReactNode} from 'react';
import type {StoryNode} from './storyTypes';
import {storyActionText} from './storyActions';
/** Earlier nodes prepend automatically on scroll; the persisted path remains complete. */
export const StoryReader=memo(function StoryReader({path,opening,inert=false,children,preferences=defaultStoryReading,onWithdraw,onRegenerate,operationsBusy=false,writing=false}:{path:StoryNode[];opening:string;inert?:boolean;children?:ReactNode;preferences?:StoryReadingPreferences;onWithdraw?:()=>void;onRegenerate?:()=>void;operationsBusy?:boolean;writing?:boolean}){
 const operations=useRef({onWithdraw,onRegenerate}),showOperations=!!onWithdraw&&!!onRegenerate;
 useLayoutEffect(()=>{operations.current={onWithdraw,onRegenerate};},[onWithdraw,onRegenerate]);
 const reader=useRef<HTMLDivElement>(null),head=useRef<string|undefined>(undefined),nearBottom=useRef(true),anchor=useRef<{height:number;top:number}|null>(null);
 const [start,setStart]=useState<number|null>(null),from=Math.min(start??Math.max(0,path.length-12),Math.max(0,path.length-1)),current=path.at(-1)?.id;
 useLayoutEffect(()=>{
  const el=reader.current;if(!el)return;
  if(path.length&&(start===null||start>from))setStart(from);
  if(anchor.current){el.scrollTop=anchor.current.top+el.scrollHeight-anchor.current.height;anchor.current=null;}
  else if(head.current!==current&&(!head.current||nearBottom.current)){const nodes=el.querySelectorAll<HTMLElement>('[data-story-sequence]');el.scrollTop=path.length===1?0:Math.max(0,(nodes[nodes.length-1]?.offsetTop??0)-el.offsetTop);}
  head.current=current;
  if(from>0&&el.scrollHeight<=el.clientHeight+80&&!anchor.current){anchor.current={height:el.scrollHeight,top:el.scrollTop};setStart(Math.max(0,from-12));}
 },[current,start,from,path.length]);
 const entries=useMemo(()=>path.slice(from).map((node,index)=>{const absolute=from+index,action=absolute?storyActionText(path[absolute-1],node):undefined;return <section className="story-entry" key={node.id} data-story-sequence={node.sequence} aria-label={`第 ${node.sequence} 段剧情`}>
   {action&&<aside className="story-action-card" data-story-action={path[absolute-1].sequence} aria-label={`第 ${path[absolute-1].sequence} 回合玩家行动`}><p className="story-action-record"><strong>{action.kind==='custom'?'自定义行动':`已选择 ${action.label}`}</strong><span>{action.text}</span></p></aside>}
   <section className="story-reading-card story-reading-surface" data-story-model={node.sequence} aria-label={`第 ${node.sequence} 回合正文`}>
   {node.id===current&&<div className="story-writing-status" role="status" aria-live="polite" aria-label="剧情书写状态">{writing?'AI 正在书写…':`本段 ${Array.from(node.body.replace(/\s/gu,'')).length} 字`}</div>}
   <div className="story-prose">{(resolveStorySegments(node.body,node.segments)??formatStoryProse(node.body)).map((part,i)=>('kind' in part&&part.kind==='break')?part.text:(('type' in part&&part.type==='dialogue')||('kind' in part&&part.kind==='dialogue'))?<blockquote className="story-dialogue" key={i} aria-label={'speaker' in part?`${part.speaker}的台词`:'无署名引语'}>{'speaker' in part&&<span className="story-speaker">{part.speaker}</span>}<span className="story-dialogue-text">{part.text}</span></blockquote>:<p className={'type' in part&&part.type==='action'?'story-action-description':'story-paragraph'} key={i}>{part.text}</p>)}</div>
   {node.id===current&&showOperations&&<footer className="story-card-operations" role="group" aria-label="本回合操作"><button aria-label="撤回" title={path.length<2?'首回合没有上一轮可撤回':'撤回本回合，回到上一轮行动'} disabled={operationsBusy||path.length<2} onClick={()=>operations.current.onWithdraw?.()}>↶ 撤回</button><button aria-label="重新生成" title="重新生成本回合会消耗 Token；失败保留原剧情" disabled={operationsBusy} onClick={()=>operations.current.onRegenerate?.()}>↻ 重新生成</button></footer>}
  </section></section>;}),[path,from,current,showOperations,operationsBusy,writing]);
 return <div ref={reader} inert={inert} className="story-reader" style={storyReadingStyle(preferences)} aria-label="连续剧情" tabIndex={0} onScroll={e=>{const el=e.currentTarget;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;if(el.scrollTop<80&&from>0&&!anchor.current){anchor.current={height:el.scrollHeight,top:el.scrollTop};setStart(Math.max(0,from-12));}}}>
  {!path.length&&<section className="story-opening">{writing&&<div className="story-writing-status" role="status" aria-live="polite" aria-label="剧情书写状态">AI 正在书写…</div>}<h2>开场情境</h2><p>{opening||'尚未填写开场情境。'}</p><p className="hint">点击开始后才会生成正文，使用当前默认 API 并消耗 Token。</p></section>}
  {!!path.length&&<section className="story-reading-history" aria-label="连续剧情正文">{entries}
</section>}
  {children&&<div className="story-next-actions">{children}</div>}
 </div>;
});
