import {memo,useLayoutEffect,useRef,useState} from 'react';
import type {StoryNode} from './storyTypes';
import {storyActionText} from './storyActions';
/** Start with a bounded DOM window. Earlier persisted nodes load in order on demand. */
export const StoryReader=memo(function StoryReader({path,opening}:{path:StoryNode[];opening:string}){
 const reader=useRef<HTMLDivElement>(null),head=useRef<string|undefined>(undefined),nearBottom=useRef(true),anchor=useRef<{height:number;top:number}|null>(null);
 const [start,setStart]=useState<number|null>(null),from=start??Math.max(0,path.length-12),current=path.at(-1)?.id;
 useLayoutEffect(()=>{
  const el=reader.current;if(!el)return;
  if(start===null&&path.length)setStart(from);
  if(anchor.current){el.scrollTop=anchor.current.top+el.scrollHeight-anchor.current.height;anchor.current=null;}
  else if(head.current!==current&&(!head.current||nearBottom.current))el.scrollTop=el.scrollHeight;
  head.current=current;
 },[current,start,from,path.length]);
 return <div ref={reader} className="story-reader" aria-label="连续剧情" tabIndex={0} onScroll={e=>{const el=e.currentTarget;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
  {from>0&&<button className="story-load-earlier" onClick={()=>{const el=reader.current!;anchor.current={height:el.scrollHeight,top:el.scrollTop};setStart(Math.max(0,from-12));}}>查看更早剧情（还有 {from} 段）</button>}
  {!path.length&&<section className="story-opening"><h2>开场情境</h2><p>{opening||'尚未填写开场情境。'}</p><p className="hint">点击开始后才会生成正文，使用当前默认 API 并消耗 Token。</p></section>}
  {path.slice(from).map((node,index)=>{const absolute=from+index,action=absolute?storyActionText(path[absolute-1],node):undefined;return <section className="story-entry" key={node.id} data-story-sequence={node.sequence} aria-label={`第 ${node.sequence} 段剧情`}>
   <div className="story-divider">第 {node.sequence} 段</div>
   {action&&<p className="story-action-record">{action.kind==='custom'?'自定义行动':`已选择 ${action.label}`} · {action.text}</p>}
   <div className="story-prose">{node.body.split(/(\r\n|\r|\n)/).map((part,i)=>i%2?part:<p className="story-paragraph" key={i}>{part}</p>)}</div>
  </section>;})}
 </div>;
});
