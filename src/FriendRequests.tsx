import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { MessageAvatar } from "./MessageUI";
import { usePhone, type Character } from "./store";
import { respondToFriendApplication } from "./chatRelationships";
export function FriendRequests({characters,onClose}:{characters:Character[];onClose:()=>void}) {
  const s=usePhone(),[working,setWorking]=useState(false),[error,setError]=useState("");
  async function respond(c:Character,accept:boolean) {
    setWorking(true);setError("");
    try { await respondToFriendApplication(c.id,c.dailyFriendship!.application!.id,accept);await s.reload(); }
    catch(e) {setError(e instanceof Error?e.message:"申请处理失败，请检查本地存储。");}
    finally {setWorking(false);}
  }
  return <section className="friend-requests" aria-label="好友申请"><header className="friend-requests-header"><button aria-label="返回聊天列表" onClick={onClose}><ChevronLeft/></button><h2>好友申请</h2></header><p className="hint">申请来自本地规则，并非 AI 自主判断；不调用 API。仅曾被你删除、有明确人设且保留双方对话的日常好友，在删除满24小时后有资格申请。每次删除最多一次，拒绝后不重复申请。</p>{error&&<p role="alert">{error}</p>}{!characters.length&&<p className="empty">暂无待处理好友申请</p>}{characters.map(c=><article className="friend-request-card" key={c.id}><div className="friend-request-person"><MessageAvatar name={c.name} src={s.assets.find(a=>a.id===c.avatar)?.data}/><strong>{c.name}</strong></div><p>{c.dailyFriendship?.application?.reason}</p><small>本地规则生成的申请理由 · 非 AI</small><div className="friend-request-actions"><button disabled={working} onClick={()=>void respond(c,false)}>拒绝</button><button className="primary" disabled={working} onClick={()=>void respond(c,true)}>接受</button></div></article>)}</section>;
}
