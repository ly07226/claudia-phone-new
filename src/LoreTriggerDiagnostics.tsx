import { useEffect, useState } from "react";
import { db } from "./store";
import type { Conversation } from "./chatTypes";
import {lastLoreTrace,loreReasonLabels,type LoreTrace} from "./loreDiagnostics";
export function LoreDiagnostics() {
  const [open,setOpen]=useState(false);
  return <section className="lore-diagnostics">
    <button onClick={()=>setOpen(!open)} aria-expanded={open}>查看最近触发诊断</button>
    {open && <TraceViewer/>}
  </section>;
}
function TraceViewer() {
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [selected,setSelected]=useState("");const [trace,setTrace]=useState<LoreTrace|null>(null);
  const [error,setError]=useState("");const [page,setPage]=useState(0);
  useEffect(()=>{let alive=true;void db.conversations.orderBy("updatedAt").reverse().limit(100).toArray().then(rows=>{if(alive){setConversations(rows);setSelected(rows[0]?.id||"");setTrace(rows[0]?lastLoreTrace(rows[0].id):null);}}).catch(()=>{if(alive)setError("无法读取会话索引。");});return()=>{alive=false;};},[]);
  return <div className="card form">
    <p className="hint">仅显示本次打开应用后的上下文组装元数据，不含正文、关键词或密钥；不是模型已接收请求的证明。只列当前范围的候选条目；未授权世界的条目不会被读取。刷新后诊断清空。</p>
    <label>会话<select aria-label="触发诊断会话" value={selected} onChange={e=>{setSelected(e.target.value);setTrace(lastLoreTrace(e.target.value));setPage(0);}}>
      {conversations.map(c=><option key={c.id} value={c.id}>{c.mode==="daily"?"日常":`世界 ${c.worldId}`} · {c.characterId} · {c.id}</option>)}
    </select></label>
    <button disabled={!selected} onClick={()=>{setTrace(lastLoreTrace(selected));setPage(0);}}>刷新诊断</button>
    {error && <p role="alert">{error}</p>}
    {!trace ? <p>本会话暂无内存诊断，请先发起一次聊天生成。</p> : <>
      <p>组装时间：{new Date(trace.createdAt).toLocaleTimeString()} · 候选 {trace.totalEntries} 条{trace.truncated?"（仅保留前1000条）":""}</p>
      {trace.diagnostics.slice(page*30,(page+1)*30).map(d=><div className="lore-trace-row" key={`${d.lorebookId}:${d.entryId}`}>
        <p>条目 ID：{d.entryId} · 世界书 ID：{d.lorebookId}</p>
        <p>模式：{d.triggerMode==="constant"?"常驻":d.triggerMode==="instant"?"即时触发":"历史触发"} · 扫描消息：{d.scannedMessageCount} · {loreReasonLabels[d.reason]}</p>
        <p>命中来源：{d.matchedMessages.map(m=>`${m.role}:${m.id}`).join("、")||"无可归属的消息"}{d.crossMessageMatch?"（跨消息匹配）":""}</p>
        <p className="hint">命中位置记录每个关键词的首个匹配；{d.attribution==="unavailable"?"本次缺少正则来源元数据":"不显示匹配文字"}。</p>
      </div>)}
      <p>跳过世界书：{trace.totalSkippedBooks} 本（最多显示前30本）</p>
      {trace.skippedBooks.slice(0,30).map(b=><p key={b.lorebookId}>世界书 ID：{b.lorebookId} · {b.reason==="out-of-scope"?"不属于当前会话范围":"世界书已停用"}</p>)}
      <div className="actions"><button disabled={!page} onClick={()=>setPage(page-1)}>上一页诊断</button><button disabled={(page+1)*30>=trace.diagnostics.length} onClick={()=>setPage(page+1)}>下一页诊断</button></div>
    </>}
  </div>;
}
