import {browserTransport,type ApiTransport,type ApiConfig} from './api';
/** Shared structured-output envelope for story creation; requestReply still owns protocols.
 * There is no role fallback or second request here. */
export function storyJSONTransport(config:ApiConfig,schema:unknown,admit:()=>Promise<boolean>){
 const gemini=config.provider==='gemini'||config.provider==='custom'&&config.protocol==='gemini';let truncated=false;
 const info:{attempted:boolean;httpStatus?:number;finishReason?:string;blocked?:boolean;serviceError?:boolean;invalidEnvelope?:boolean;invalidContent?:boolean;textCharacters?:number}={attempted:false};
 const transport:ApiTransport={send:async(url,init)=>{
  const body=JSON.parse(String(init.body));if(gemini)body.generationConfig={...body.generationConfig,responseMimeType:'application/json',responseSchema:schema};else body.response_format={type:'json_object'};
  if(!await admit())throw Error('stale');
  info.attempted=true;const response=await browserTransport.send(url,{...init,body:JSON.stringify(body)});
  info.httpStatus=response.status;if(!response.ok)return response;
  let data:any;try{data=await response.clone().json();}catch{info.invalidEnvelope=true;return response;}
  const finish=gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason;truncated=['length','MAX_TOKENS','max_tokens'].includes(finish);
  if(['length','MAX_TOKENS','max_tokens','stop','STOP','SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST','content_filter'].includes(finish))info.finishReason=finish;
  if(gemini&&Array.isArray(data?.candidates?.[0]?.content?.parts)){
   const parts=data.candidates[0].content.parts;
   if(parts.some((p:any)=>!p||typeof p!=='object'||Array.isArray(p)))info.invalidContent=true;
   data.candidates[0].content.parts=parts.filter((p:any)=>!p?.thought);
  }
  info.serviceError=!!data?.error;
  info.blocked=['SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST','content_filter'].includes(finish)||!!data?.promptFeedback?.blockReason;
  const m=data?.choices?.[0]?.message;if(!gemini&&Array.isArray(m?.content)&&m.content.every((p:any)=>['text','output_text'].includes(p?.type)&&typeof p?.text==='string'))m.content=m.content.map((p:any)=>p.text).join('');
  const parts=data?.candidates?.[0]?.content?.parts;
  const text=gemini?(Array.isArray(parts)?parts.map((p:any)=>typeof p?.text==='string'?p.text:'').join(''):undefined):m?.content;info.textCharacters=typeof text==='string'?text.length:0;
  info.invalidContent=!!info.invalidContent||gemini&&parts!=null&&!Array.isArray(parts)||text!=null&&typeof text!=='string'||!info.serviceError&&!info.blocked&&!(gemini?Array.isArray(data?.candidates):Array.isArray(data?.choices));
  return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
 }};
 return {transport,isTruncated:()=>truncated,getResponseInfo:()=>({...info})};
}
