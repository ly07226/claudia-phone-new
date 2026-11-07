import {formatStoryProse} from './storyProse';
import {memo,useLayoutEffect,useRef,useState} from 'react';
import type {StoryNode} from './storyTypes';
import {storyActionText} from './storyActions';
/** Earlier nodes prepend automatically on scroll; the persisted path remains complete. */
export const StoryReader=memo(function StoryReader({path,opening,inert=false}:{path:StoryNode[];opening:string;inert?:boolean}){
 const reader=useRef<HTMLDivElement>(null),head=useRef<string|undefined>(undefined),nearBottom=useRef(true),anchor=useRef<{height:number;top:number}|null>(null);
 const [start,setStart]=useState<number|null>(null),from=start??Math.max(0,path.length-12),current=path.at(-1)?.id;
 useLayoutEffect(()=>{
  const el=reader.current;if(!el)return;
  if(start===null&&path.length)setStart(from);
  if(anchor.current){el.scrollTop=anchor.current.top+el.scrollHeight-anchor.current.height;anchor.current=null;}
  else if(head.current!==current&&(!head.current||nearBottom.current))el.scrollTop=el.scrollHeight;
  head.current=current;
  if(from>0&&el.scrollHeight<=el.clientHeight+80&&!anchor.current){anchor.current={height:el.scrollHeight,top:el.scrollTop};setStart(Math.max(0,from-12));}
 },[current,start,from,path.length]);
 return <div ref={reader} inert={inert} className="story-reader" aria-label="连续剧情" tabIndex={0} onScroll={e=>{const el=e.currentTarget;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;if(el.scrollTop<80&&from>0&&!anchor.current){anchor.current={height:el.scrollHeight,top:el.scrollTop};setStart(Math.max(0,from-12));}}}>
  {!path.length&&<section className="story-opening"><h2>开场情境</h2><p>{opening||'尚未填写开场情境。'}</p><p className="hint">点击开始后才会生成正文，使用当前默认 API 并消耗 Token。</p></section>}
  {!!path.length&&<section className="story-reading-card" aria-label="连续剧情正文"><div className="story-card-meta">已保存 {path.length} 段</div>
  {path.slice(from).map((node,index)=>{const absolute=from+index,action=absolute?storyActionText(path[absolute-1],node):undefined;return <section className="story-entry" key={node.id} data-story-sequence={node.sequence} aria-label={`第 ${node.sequence} 段剧情`}>
   {path.length>1&&<div className="story-node-marker">第 {node.sequence} 段</div>}
   {action&&<p className="story-action-record">{action.kind==='custom'?'自定义行动':`已选择 ${action.label}`} · {action.text}</p>}
   <div className="story-prose">{formatStoryProse(node.body).map((part,i)=>part.kind==='break'?part.text:part.kind==='dialogue'?<blockquote className="story-dialogue" key={i} aria-label="无署名引语">{part.text}</blockquote>:<p className="story-paragraph" key={i}>{part.text}</p>)}</div>
  </section>;})}</section>}
 </div>;
});
