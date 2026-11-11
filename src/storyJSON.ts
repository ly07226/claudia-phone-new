import {storyProviderBudgetError} from './storyOutputBudget';
import {readChatResponse} from './chatCompletion';
import {browserTransport,type ApiTransport,type ApiConfig} from './api';
/** Shared structured-output envelope for story creation; requestReply still owns protocols.
 * There is no role fallback or second request here. */
export function storyJSONTransport(config:ApiConfig,schema:unknown,admit:()=>Promise<boolean>,observeStream=false){
 const gemini=config.provider==='gemini'||config.provider==='custom'&&config.protocol==='gemini';let truncated=false;let partialText='';
 const info:{attempted:boolean;httpStatus?:number;finishReason?:string;blocked?:boolean;serviceError?:boolean;invalidEnvelope?:boolean;invalidContent?:boolean;textCharacters?:number;outputTokens?:number;transportInterrupted?:boolean;contextWindow?:true;modelOutputLimit?:number;outputRejected?:true}={attempted:false};
 const transport:ApiTransport={send:async(url,init)=>{
  const body=JSON.parse(String(init.body));if(gemini)body.generationConfig={...body.generationConfig,responseMimeType:'application/json',responseSchema:schema};else body.response_format={type:'json_object'};
  if(!await admit())throw Error('stale');
  info.attempted=true;const response=await browserTransport.send(url,{...init,body:JSON.stringify(body)});
  info.httpStatus=response.status;if(!response.ok){if(response.status===400||response.status===422){const evidence=storyProviderBudgetError(await response.clone().json().catch(()=>null));if(evidence.contextWindow)info.contextWindow=true;if(evidence.outputRejected)info.outputRejected=true;if(evidence.modelLimit)info.modelOutputLimit=evidence.modelLimit;}return response;}
  let data:any;try{
   if(observeStream&&response.headers.get('content-type')?.includes('text/event-stream')){
    // Observe only usage counters while passing the same bytes to the shared
    // reader. No extra request, no response正文 retained by this observer.
    let buffer='';const decoder=new TextDecoder();
    const observe=(packet:string)=>{try{const raw=packet.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw||raw==='[DONE]')return;const x=JSON.parse(raw),tokens=gemini?x?.usageMetadata?.candidatesTokenCount:x?.usage?.completion_tokens;if(Number.isSafeInteger(tokens)&&tokens>=0)info.outputTokens=tokens;}catch{/* The primary reader validates event data. */}};
    const stream=response.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){buffer+=decoder.decode(chunk,{stream:true});let m:RegExpExecArray|null;while((m=/\r?\n\r?\n/.exec(buffer))){observe(buffer.slice(0,m.index));buffer=buffer.slice(m.index+m[0].length);}if(buffer.length>500000)throw Error('response limit');controller.enqueue(chunk);},flush(){buffer+=decoder.decode();if(buffer.trim())observe(buffer);}}));
    const result=await readChatResponse(new Response(stream,{headers:response.headers}),gemini,init.signal??new AbortController().signal);data=result.data;
    if(result.interruption&&result.interruption!=='length'&&result.interruption!=='blocked')info.transportInterrupted=true;
   }else data=await response.clone().json();
  }catch(error){if(!observeStream||error instanceof SyntaxError)info.invalidEnvelope=true;else info.transportInterrupted=true;return response;}
  const usage=gemini?data?.usageMetadata?.candidatesTokenCount:data?.usage?.completion_tokens;
  if(Number.isSafeInteger(usage)&&usage>=0)info.outputTokens=usage;
  const finish=gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason;truncated=['length','MAX_TOKENS','max_tokens'].includes(finish);
  if(['length','MAX_TOKENS','max_tokens','stop','STOP','SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST','content_filter'].includes(finish))info.finishReason=finish;else if(finish!==undefined)info.finishReason='unknown';
  if(gemini&&Array.isArray(data?.candidates?.[0]?.content?.parts)){
   const parts=data.candidates[0].content.parts;
   if(parts.some((p:any)=>!p||typeof p!=='object'||Array.isArray(p)))info.invalidContent=true;
   data.candidates[0].content.parts=parts.filter((p:any)=>!p?.thought);
  }
  info.serviceError=!!data?.error;
  info.blocked=['SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST','content_filter'].includes(finish)||!!data?.promptFeedback?.blockReason;
  const m=data?.choices?.[0]?.message;if(!gemini&&Array.isArray(m?.content)&&m.content.every((p:any)=>['text','output_text'].includes(p?.type)&&typeof p?.text==='string'))m.content=m.content.map((p:any)=>p.text).join('');
  const parts=data?.candidates?.[0]?.content?.parts;
  const text=gemini?(Array.isArray(parts)?parts.map((p:any)=>typeof p?.text==='string'?p.text:'').join(''):undefined):m?.content;info.textCharacters=typeof text==='string'?text.length:0;partialText=typeof text==='string'&&text.length<=100000?text:'';
  info.invalidContent=!!info.invalidContent||gemini&&parts!=null&&!Array.isArray(parts)||text!=null&&typeof text!=='string'||!info.serviceError&&!info.blocked&&!(gemini?Array.isArray(data?.candidates):Array.isArray(data?.choices));
  return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
 }};
 return {transport,isTruncated:()=>truncated,getResponseInfo:()=>({...info}),getPartialText:()=>partialText};
}
