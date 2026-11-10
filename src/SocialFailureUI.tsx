import {useEffect,useState} from 'react';
import {MessageSheet} from './MessageUI';
import {socialFailureLabel,type SocialFailure} from './socialFailures';
export function SocialFailureNotice({failure,actor,active=true}:{failure:SocialFailure;actor?:string;active?:boolean}){
 const [open,setOpen]=useState(false),label=socialFailureLabel(failure.kind);
 useEffect(()=>{if(!active)setOpen(false);},[active]);
 return <div className="hub-failure" data-social-failure={failure.id} role="alert"><button type="button" aria-label={`${label}，查看详情`} onClick={()=>setOpen(true)}><span aria-hidden="true">!</span>{actor?`${actor} · `:''}{label}</button>{open&&active&&<MessageSheet title={`${label}详情`} className="reply-failure-sheet" onClose={()=>setOpen(false)}><p><strong>原因：</strong>{failure.details.reason}</p><p><strong>建议：</strong>{failure.details.suggestion}</p>{failure.details.httpStatus&&<small>HTTP {failure.details.httpStatus}</small>}{failure.details.serviceCode&&<small>{failure.details.serviceCode}</small>}{failure.details.serviceMessage&&<p>{failure.details.serviceMessage}</p>}</MessageSheet>}</div>;
}
