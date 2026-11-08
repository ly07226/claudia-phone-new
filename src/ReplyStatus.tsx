import {useState} from 'react';
import {Info} from 'lucide-react';
import {MessageSheet} from './MessageUI';
import type {ReplyFailureDetails} from './replyFailure';
import './replyStatus.css';
export function ReplyPending({className=''}:{className?:string}){return <span className={`reply-pending ${className}`} role="status">正在回复…</span>;}
export function ReplyFailureNotice({details,className=''}:{details:ReplyFailureDetails;className?:string}){
 const [open,setOpen]=useState(false);
 return <div className={`reply-failure ${className}`} role="alert"><button type="button" className="reply-failure-pill" aria-label="回复失败，查看详情" onClick={()=>setOpen(true)}>回复失败 <Info size={13} aria-hidden="true"/></button>{open&&<MessageSheet title="回复失败详情" className="reply-failure-sheet" onClose={()=>setOpen(false)}><p><strong>原因：</strong>{details.reason}</p><p><strong>建议：</strong>{details.suggestion}</p>{(details.httpStatus||details.serviceCode)&&<small>{details.httpStatus?`HTTP ${details.httpStatus}`:''}{details.serviceCode?`${details.httpStatus?' · ':''}${details.serviceCode}`:''}</small>}{details.serviceMessage&&<p className="reply-service-message">服务信息：{details.serviceMessage}</p>}</MessageSheet>}</div>;
}
