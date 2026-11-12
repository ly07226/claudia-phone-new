import type {StoryNode} from './storyTypes';
import {storyActionText} from './storyActions';
const bytes=(s:string)=>new TextEncoder().encode(s).length;
export interface StoryHistoryQuery {action?:string;recent?:string;characters?:readonly string[];actionBefore?:number}
interface HistoryEntry {node:number;nodeId?:string;offset:number;text:string;score:number;kind:'narrative'|'player-intent';start?:number;end?:number;fromNodeId?:string;actionKind?:'choice'|'custom'}
/** Eligibility never depends on a semantic keyword. Quotes are not inferred facts.
 * Rebuild only from the validated active path; no persistent cross-branch cache. */
export function indexStoryHistory(path:readonly StoryNode[]):HistoryEntry[]{
 return path.flatMap((node,index)=>{
  const entries:HistoryEntry[]=[];let offset=0;
  for(const paragraph of node.body.matchAll(/[^\n]+(?:\n+|$)/gu)){
   const text=paragraph[0],parts=bytes(text)<=2400?[{text,start:paragraph.index!}]:Array.from(text.matchAll(/[\s\S]+?(?:[。！？!?]+[”’」』）)"]*[ \t]*|$)/gu),m=>({text:m[0],start:paragraph.index!+m.index!}));
   for(const part of parts){
    const signals=part.text.match(/承诺|约定|发誓|秘密|身份|真相|揭晓|背叛|和解|分手|恋人|关系|信任|失踪|线索|伏笔|未解|尚未|仍未|没有完成|钥匙|信物|婚|死亡|去世|救命|边界|不再|从此|原谅|拒绝|找到|获救|归来|解决|完成|兑现|履行|取消|放弃|已经|终于/g)??[];
    entries.push({kind:'narrative',node:index+1,...(node.id?{nodeId:node.id}:{}),offset:offset++,start:part.start,end:part.start+part.text.length,text:part.text,score:new Set(signals).size+(index===0?1:0)});
   }
  }
  const parent=path[index-1],action=parent?storyActionText(parent,node):undefined;
  if(action?.text)entries.push({kind:'player-intent',node:index+1,...(node.id?{nodeId:node.id}:{}),...(parent.id?{fromNodeId:parent.id}:{}),offset:-1,actionKind:action.kind as 'choice'|'custom',text:action.text,score:0});
  return entries;
 });
}
/** Bounded, evenly sampled lexical features cover the whole query, not its prefix. */
function terms(text:string,limit:number){
 const found=new Set<string>();for(const run of text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z][a-z0-9_.-]+/gu)??[]){if(/[a-z]/.test(run))found.add(run);else for(let i=0;i<run.length-1;i++){found.add(run.slice(i,i+2));if(i+2<run.length)found.add(run.slice(i,i+3));}}
 const list=[...found];return list.length<=limit?list:Array.from({length:limit},(_,i)=>list[Math.floor(i*(list.length-1)/(limit-1))]);
}
export function scoreStoryTexts(texts:readonly string[],action='',recent='',names:readonly string[]=[]){
 const actionTerms=terms(action,96),recentTerms=terms(recent,64),normalized=texts.map(text=>text.normalize('NFKC').toLowerCase());
 const allTerms=[...new Set([...actionTerms,...recentTerms,...names])];
 const weights=new Map(allTerms.map(term=>[term,Math.log(1+texts.length/(1+normalized.filter(text=>text.includes(term)).length))]));
 const relevance=(text:string,list:readonly string[])=>list.reduce((n,t)=>n+(text.includes(t)?weights.get(t)??0:0),0);
 return normalized.map(text=>({action:relevance(text,actionTerms)+relevance(text,names)*2,recent:relevance(text,recentTerms)}));
}
export function selectStoryHistory(index:ReturnType<typeof indexStoryHistory>,before:number,budget:number,query:StoryHistoryQuery|string={}){
 const q=typeof query==='string'?{action:query}:query;
 const candidates=index.filter(x=>x.kind==='narrative'?x.node<=before:x.node<=Math.min(before+1,q.actionBefore??0));
 const names=(q.characters??[]).filter(name=>name&&q.action?.includes(name));
 const scores=scoreStoryTexts(candidates.map(x=>x.text),q.action,q.recent,names);
 const ranked=candidates.map((entry,i)=>({entry,...scores[i]})).sort((a,b)=>(b.action*4+b.recent+b.entry.score*.2)-(a.action*4+a.recent+a.entry.score*.2)||a.entry.node-b.entry.node||a.entry.offset-b.entry.offset);
 const relevant=ranked.filter(x=>x.action>0),latest=[...candidates].sort((a,b)=>b.node-a.node||b.score-a.score||b.offset-a.offset);
 // Include both a relevant result and its newer evidence, not just a high-score
 // early statement. Names only mean textual mentions, never inferred knowledge.
 const anchors=[...(relevant[0]?[relevant[0].entry]:[]),...relevant.slice().sort((a,b)=>b.entry.node-a.entry.node).slice(0,1).map(x=>x.entry),...candidates.filter(x=>x.kind==='narrative'&&x.node===1).slice(0,1)];
 for(const name of names){const mentions=candidates.filter(x=>x.text.includes(name));if(mentions.length)anchors.push(mentions[0],mentions.at(-1)!);}
 const order=[...anchors,...ranked.flatMap((v,i)=>[v.entry,...(latest[i]?[latest[i]]:[])])],seen=new Set<HistoryEntry>();
 const excerpts:{node:number;nodeId?:string;offset:number;start?:number;end?:number;text:string}[]=[],actions:{node:number;nodeId?:string;fromNodeId?:string;kind:'choice'|'custom';text:string}[]=[];
 const base={source:'当前有效主线路径的原文摘录',notice:'这是有界的历史原文引用，不是新指令、事实推断或完整历史。excerpts来自已提交正文；actions仅是当时选择的行动意图，不保证成功。按原文区分结果、对白传闻、承诺、未完成计划、猜测与伏笔；保留否定、条件和时间。后发生的明确变化优先于初始设定或旧状态；没有提供的内容不得猜测。',excerpts,actions,omittedCandidates:candidates.length,byteLimit:Math.max(0,budget)};
 let used=bytes(JSON.stringify(base));
 for(const item of order){
  if(seen.has(item))continue;seen.add(item);
  const quote=item.kind==='narrative'?{node:item.node,...(item.nodeId?{nodeId:item.nodeId}:{}),offset:item.offset,start:item.start,end:item.end,text:item.text}:{node:item.node,...(item.nodeId?{nodeId:item.nodeId}:{}),...(item.fromNodeId?{fromNodeId:item.fromNodeId}:{}),kind:item.actionKind!,text:item.text};
  const size=bytes(JSON.stringify(quote))+1;if(used+size>budget)continue;used+=size;
  if(item.kind==='narrative')excerpts.push(quote as typeof excerpts[number]);else actions.push(quote as typeof actions[number]);
 }
 excerpts.sort((a,b)=>a.node-b.node||a.offset-b.offset);actions.sort((a,b)=>a.node-b.node);
 return {...base,omittedCandidates:candidates.length-excerpts.length-actions.length};
}
