import {browserTransport,type ApiTransport,type ApiConfig} from './api';
/** Shared structured-output envelope for story creation; requestReply still owns protocols.
 * There is no role fallback or second request here. */
export function storyJSONTransport(config:ApiConfig,schema:unknown,admit:()=>Promise<boolean>){
 const gemini=config.provider==='gemini'||config.provider==='custom'&&config.protocol==='gemini';let truncated=false;
 const transport:ApiTransport={send:async(url,init)=>{
  const body=JSON.parse(String(init.body));if(gemini)body.generationConfig={...body.generationConfig,responseMimeType:'application/json',responseSchema:schema};else body.response_format={type:'json_object'};
  if(!await admit())throw Error('stale');
  const response=await browserTransport.send(url,{...init,body:JSON.stringify(body)});
  if(!response.ok)return response;
  const data=await response.clone().json(),finish=gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason;truncated=['length','MAX_TOKENS','max_tokens'].includes(finish);
  if(gemini&&Array.isArray(data?.candidates?.[0]?.content?.parts))data.candidates[0].content.parts=data.candidates[0].content.parts.filter((p:any)=>!p.thought);
  const m=data?.choices?.[0]?.message;if(!gemini&&Array.isArray(m?.content)&&m.content.every((p:any)=>['text','output_text'].includes(p.type)&&typeof p.text==='string'))m.content=m.content.map((p:any)=>p.text).join('');
  return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
 }};
 return {transport,isTruncated:()=>truncated};
}
