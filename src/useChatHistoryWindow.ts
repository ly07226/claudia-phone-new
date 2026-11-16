import {useLayoutEffect,useMemo,useRef,useState,type RefObject,type MutableRefObject} from 'react';
import {HistoryLayout} from './historyLayout';
import type {Message} from './chatTypes';
const windowSize=120,overscan=30;
type Anchor={id:string;top:number};
/** One scrolling surface, bidirectional DOM recycling, measured variable-height
 * groups. Spacers never render a different bubble or store a second history. */
export function useChatHistoryWindow(messages:Message[],ref:RefObject<HTMLDivElement|null>,scope:string|undefined,follow:MutableRefObject<boolean>){
 const measurements=useRef(new Map<string,number>()),previousScope=useRef(scope),previousLayout=useRef<HistoryLayout|undefined>(undefined);
 if(previousScope.current!==scope){measurements.current=new Map();previousLayout.current=undefined;previousScope.current=scope;}
 const layout=useMemo(()=>new HistoryLayout(messages.map(m=>m.id),measurements.current),[messages,scope]);
 const [range,setRange]=useState({scope,start:Math.max(0,messages.length-windowSize)});
 const old=previousLayout.current;let start=range.scope===scope?range.start:Math.max(0,messages.length-windowSize);
 if(old!==layout){if(follow.current)start=Math.max(0,messages.length-windowSize);else{const id=old?.ids[start];if(id&&layout.positions.has(id))start=layout.positions.get(id)!;}}
 start=Math.max(0,Math.min(start,Math.max(0,messages.length-windowSize)));const end=Math.min(messages.length,start+windowSize);
 const anchor=useRef<Anchor|null>(null),frame=useRef(0),measureFrame=useRef(0),navigating=useRef(false),current=useRef({layout,start,end,scope});current.current={layout,start,end,scope};
 const rows=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('.chat-message-row')??[]);
 const idOf=(row:HTMLElement)=>row.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId;
 function capture(){const el=ref.current;if(!el)return;const top=el.getBoundingClientRect().top;const row=rows().find(row=>row.getBoundingClientRect().bottom>top);const id=row&&idOf(row);if(row&&id)anchor.current={id,top:row.getBoundingClientRect().top-top};}
 function measure(){const el=ref.current;if(!el)return;const entries=rows();const bottom=el.querySelector<HTMLElement>('[data-history-bottom]');for(let i=0;i<entries.length;i++){const row=entries[i],id=idOf(row),index=id?current.current.layout.positions.get(id):undefined;if(index===undefined||!id)continue;const first=row.previousElementSibling instanceof HTMLElement&&row.previousElementSibling.dataset.chatTimeFor===id?row.previousElementSibling:row;const next=entries[i+1];const nextId=next&&idOf(next);const edge=next?(next.previousElementSibling instanceof HTMLElement&&next.previousElementSibling.dataset.chatTimeFor===nextId?next.previousElementSibling:next):bottom;if(!edge)continue;const height=edge.getBoundingClientRect().top-first.getBoundingClientRect().top;if(height>0){measurements.current.set(id,height);current.current.layout.measure(index,height);}}}
 function choose(next:number,navigation=false){const state=current.current;next=Math.max(0,Math.min(next,Math.max(0,state.layout.ids.length-windowSize)));if(next===state.start)return;capture();navigating.current=navigation;setRange({scope:state.scope,start:next});}
 function reveal(index:number){if(index>=current.current.start&&index<current.current.end)return true;choose(index-overscan,true);return false;}
 function onScroll(){if(frame.current)return;frame.current=requestAnimationFrame(()=>{frame.current=0;const el=ref.current;if(!el||navigating.current)return;measure();const state=current.current;const first=state.layout.indexAt(el.scrollTop),last=state.layout.indexAt(el.scrollTop+el.clientHeight);if(first<state.start+10&&state.start>0||last>state.end-10&&state.end<state.layout.ids.length)choose(first-overscan);});}
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;measure();
  if(anchor.current){const saved=anchor.current;const row=rows().find(r=>idOf(r)===saved.id);if(row&&!navigating.current)el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top-saved.top;else if(navigating.current)el.scrollTop=layout.offset(start);anchor.current=null;}
  navigating.current=false;previousLayout.current=layout;
  // Keep state in agreement with data growth/deletions without growing the DOM.
  if(range.scope!==scope||range.start!==start)setRange({scope,start});
  const observer=new ResizeObserver(()=>{if(measureFrame.current)return;measureFrame.current=requestAnimationFrame(()=>{measureFrame.current=0;measure();if(follow.current)el.scrollTop=el.scrollHeight;});});
  for(const child of Array.from(el.children))if(!(child as HTMLElement).hasAttribute('data-history-spacer'))observer.observe(child);
  return()=>{observer.disconnect();cancelAnimationFrame(measureFrame.current);measureFrame.current=0;};
 },[layout,start,end,scope]);
 useLayoutEffect(()=>()=>{cancelAnimationFrame(frame.current);cancelAnimationFrame(measureFrame.current);},[]);
 return {start,end,top:layout.offset(start),bottom:layout.offset(messages.length)-layout.offset(end),reveal,onScroll,beforeChange:capture};
}
