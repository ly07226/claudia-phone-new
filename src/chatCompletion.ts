/** Protocol evidence only; never infer completion from punctuation or parentheses. */
export type ReplyInterruption = 'length' | 'network' | 'timeout' | 'stream' | 'blocked';
export const validInterruption=(value:unknown):value is ReplyInterruption=>['length','network','timeout','stream','blocked'].includes(value as string);
export function completionReason(reason:unknown):ReplyInterruption|undefined {
 if(reason==='length'||reason==='MAX_TOKENS')return 'length';
 if(['content_filter','SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST'].includes(String(reason)))return 'blocked';
 if(reason && !['stop','STOP','end_turn'].includes(String(reason)))return 'stream';
}
export function interruptionLabel(reason:ReplyInterruption){
 return {length:'回复达到输出长度限制，已保留已生成内容。',network:'回复传输中断，已保留已收到内容。',timeout:'回复请求已超时，已保留已收到内容。',stream:'回复未收到完整结束确认，已保留已收到内容。',blocked:'服务商中止了回复，已保留已收到内容。'}[reason];
}
/** Some compatible gateways return SSE despite stream:false. Keep complete deltas
 * through split UTF-8/event boundaries and require protocol completion evidence. */
export async function readChatResponse(response:Response,gemini:boolean,signal:AbortSignal){
 if(!response.ok||!response.headers.get('content-type')?.includes('text/event-stream'))return {data:await response.json(),interruption:undefined as ReplyInterruption|undefined};
 const reader=response.body?.getReader();if(!reader)throw Error('empty response');
 const decoder=new TextDecoder();let buffer='',content='',finish:unknown,terminal=false,invalid=false;
 const event=(packet:string)=>{
  const payload=packet.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!payload)return;
  if(payload.trim()==='[DONE]'){terminal=true;return;}
  try {
   const data=JSON.parse(payload);if(data.error){invalid=true;return;}
   const c=gemini?data.candidates?.[0]:data.choices?.find((c:any)=>c.index===undefined||c.index===0);
   const text=gemini?c?.content?.parts?.filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join(''):c?.delta?.content;
   if(typeof text==='string')content+=text;
   const reason=gemini?c?.finishReason:c?.finish_reason;
   if(reason){finish=reason;terminal=true;}
  }catch{invalid=true;}
 };
 let failed=false;
 try {
  while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let match:RegExpExecArray|null;
   while((match=/\r?\n\r?\n/.exec(buffer))){event(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}
   if(content.length>100000||buffer.length>500000)throw Error('response limit');
  }
  buffer+=decoder.decode();if(buffer.trim())event(buffer);
 }catch{failed=true;}
 finally{try{await reader.cancel();}catch{/* transport already closed */}}
 if(content.length>100000)throw Error('response limit');
 const interruption:ReplyInterruption|undefined=failed?(signal.aborted?'timeout':'network'):invalid||!terminal?'stream':completionReason(finish);
 const data=gemini?{candidates:[{content:{parts:[{text:content}]},finishReason:finish}]}:{choices:[{message:{content},finish_reason:finish}]};
 return {data,interruption};
}
/** Exact overlap only. Never summarize, autoclose, or replace the original text. */
export function appendContinuation(original:string,next:string){
 let overlap=0;
 for(let n=Math.min(original.length,next.length);n>0;n--)if(original.endsWith(next.slice(0,n))){if(n>=8||n===original.length)overlap=n;break;}
 const suffix=next.slice(overlap);
 if(!suffix.trim())throw Error('续接未返回新的内容，原回复已保留。');
 if(original.length+suffix.length>100000)throw Error('续接内容超出消息容量，原回复已保留。');
 return original+suffix;
}
