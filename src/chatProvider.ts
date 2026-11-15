import {readChatResponse,completionReason,type ReplyInterruption} from './chatCompletion';
import {ReplyRequestError,replyFailureDetails} from './replyFailure';
import {linkRequestDiagnostics,recordRequestAttempt,recordRequestResponse,recordRequestFailure} from './chatRequestDiagnostics';
import {
  validateConfig,
  type ApiConfig,
  type ApiTransport,
  browserTransport,
} from "./api";
import type { ContextMessage } from "./chatTypes";
export function assertImageProvider(c:ApiConfig){
  if(!(c.provider==='gemini'||['openai','openai-compatible','openrouter'].includes(c.provider)||(c.provider==='custom'&&['gemini','openai-chat'].includes(c.protocol||''))))throw Error('此 Provider 未支持图片输入协议，请更换支持视觉输入的配置。');
  if(/gpt-3\.5|embedding|whisper|(?:^|[-/])tts(?:$|[-/])|dall-e/i.test(c.model))throw Error('当前模型不支持图片聊天，请选择视觉模型。图片草稿仍保留。');
}
export function openaiMessages(messages:ContextMessage[]){return messages.map(m=>({role:m.role,content:m.images?.length?[...(m.content?[{type:'text',text:m.content}]:[]),...m.images.map(i=>({type:'image_url',image_url:{url:i.data}}))]:m.content}));}
/** Gemini has one systemInstruction. In-history system entries degrade to labelled user context at the same slot. */
export function geminiMessages(messages: ContextMessage[]) {
  const contents: { role: "user" | "model"; parts: { text?: string; inlineData?: {mimeType:string;data:string} }[] }[] = [];
  for (const m of messages.slice(1)) {
    const role = m.role === "assistant" ? "model" : "user";
    const text =
      m.role === "system" ? `[系统设定资料]\n${m.content}` : m.content;
    const last = contents.at(-1);
    const parts=[...(text?[{text}]:[]),...(m.images||[]).map(i=>({inlineData:{mimeType:i.mimeType,data:i.data.slice(i.data.indexOf(",")+1)}}))];
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  // Avoid a leading model turn or trailing assistant prefill on restrictive Gemini endpoints.
  if (contents[0]?.role === "model")
    contents[0] = {
      role: "user",
      parts: [{ text: "[角色参考资料]" }, ...contents[0].parts],
    };
  if (contents.at(-1)?.role === "model") {
    const last = contents.pop()!;
    const text = last.parts.map((p) => p.text).join("\n");
    const tail = contents.at(-1);
    if (tail?.role === "user")
      tail.parts.push({ text: `[角色参考资料]\n${text}` });
    else
      contents.push({
        role: "user",
        parts: [{ text: `[角色参考资料]\n${text}` }],
      });
  }
  return contents;
}
/** Direct browser transport: no public arbitrary-URL server proxy is exposed. */
export async function requestReply(
  c: ApiConfig,
  key: string,
  messages: ContextMessage[],
  signal: AbortSignal,
  transport: ApiTransport = browserTransport,
  allowRoleFallback = true,
  onCompletion?: (reason:ReplyInterruption|undefined)=>void,
): Promise<string> {
  const hasImages=messages.some(m=>m.images?.length);
  if(hasImages)assertImageProvider(c);
  const error = validateConfig(c, key);
  if (error) throw Error(error);
  if (!c.enabled) throw Error("API 配置已停用。");
  const gemini =
    c.provider === "gemini" ||
    (c.provider === "custom" && c.protocol === "gemini");
  if (
    !gemini &&
    !["openai", "openai-compatible", "openrouter"].includes(c.provider) &&
    !(c.provider === "custom" && c.protocol === "openai-chat")
  )
    throw Error("此 Provider 尚不支持聊天，请选择已支持的请求协议。");
  const base = c.baseUrl.replace(/\/+$/, "");
  const url = gemini
    ? `${base}/models/${encodeURIComponent(c.model.replace(/^models\//, ""))}:generateContent`
    : `${base}/chat/completions`;
  // Gemini supports exactly one systemInstruction. Preserve all system-role
  // lore as actual system instruction rather than downgrading it to user text.
  const geminiSystem=messages.filter(m=>m.role==="system").map(m=>m.content).join("\n\n");
  const geminiContext=gemini
    ? [messages[0],...messages.slice(1).filter(m=>m.role!=="system")]
    : messages;
  const body = gemini
    ? {
        systemInstruction: { parts: [{ text: geminiSystem }] },
        contents: geminiMessages(geminiContext),
        generationConfig: {
          temperature: c.temperature,
          maxOutputTokens: c.maxTokens,
        },
      }
    : {
        model: c.model,
        messages:openaiMessages(messages),
        temperature: c.temperature,
        ...(c.provider === "openai"
          ? { max_completion_tokens: c.maxTokens }
          : { max_tokens: c.maxTokens }),
        stream: false,
      };
  let response: Response;
  recordRequestAttempt(messages,gemini?'gemini':'openai',gemini?['system',...body.contents!.map(m=>m.role==='model'?'assistant' as const:'user' as const)]:messages.map(m=>m.role));
  try {
    response = await transport.send(url, {
      method: "POST",
      headers: gemini
        ? { "Content-Type": "application/json", "x-goog-api-key": key }
        : {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch {
    recordRequestFailure(messages,'network-error');
    throw new ReplyRequestError(
      signal.aborted
        ? "请求已取消或超时，已保存的消息不会丢失。"
        : "网络请求失败，可能是网络、CORS、TLS 或重定向限制。服务必须支持浏览器直连；请勿使用不可信公共代理。",
      replyFailureDetails({network:true}),
    );
  }
  let data;
  let interruption:ReplyInterruption|undefined;
  try {
    if(onCompletion){const result=await readChatResponse(response,gemini,signal);data=result.data;interruption=result.interruption;}
    else data = await response.json();
  } catch (error) {
    if(onCompletion&&!(error instanceof SyntaxError)){
      recordRequestFailure(messages,'network-error');
      throw new ReplyRequestError(signal.aborted?"请求已取消或超时，已保存的消息不会丢失。":"回复传输中断，已保存的消息不会丢失。",replyFailureDetails({network:true}));
    }
    recordRequestFailure(messages,'invalid-response',response.status);
    throw new ReplyRequestError("服务响应不是有效 JSON，请检查接口地址。",replyFailureDetails({httpStatus:response.status}));
  }
  const roleError =
    String(data?.error?.code || "") +
    " " +
    String(data?.error?.param || "") +
    " " +
    String(data?.error?.message || "");
  if(hasImages&&[400,404,415,422].includes(response.status)&&/image|vision|multimodal|inline.?data|mime.?type/i.test(roleError))throw Error('当前模型或服务拒绝图片输入。请检查视觉能力与图片限制；已保存的图片和文字仍保留。');
  if (
    !gemini &&
    allowRoleFallback &&
    [400, 422].includes(response.status) &&
    /unsupported[_ ]role|invalid[_ ]role|messages\[.*\]\.role|role.{0,60}(unsupported|not supported|not allowed)|does not support.{0,40}(system|assistant|user)/i.test(
      roleError,
    )
  ) {
    const fallback: ContextMessage[] = messages.map((m) => ({
      role: "user",
      ...(m.images?.length?{images:m.images}:{}),
      content:
        m.role === "user"
          ? m.content
          : `[${m.role === "system" ? "系统资料" : "角色历史或设定"}]\n${m.content}`,
    }));
    linkRequestDiagnostics(messages,fallback);
    return requestReply(c, key, fallback, signal, transport, false, onCompletion);
  }
  if (!response.ok || data?.error) {
    recordRequestFailure(messages,'http-error',response.status);
    throw new ReplyRequestError(
      response.status === 401 || response.status === 403
        ? "API 认证失败，请检查 Key 和权限。"
        : response.status === 429
          ? "额度不足或请求过于频繁，请稍后再试。"
          : response.status === 404
            ? "模型或接口不存在，请检查 Model 和 Base URL。"
            : `模型请求失败（HTTP ${response.status}），请检查参数和服务状态。`,
      replyFailureDetails({httpStatus:response.status,code:data?.error?.code??data?.error?.status,message:data?.error?.message},[key]),
    );
  }
  const content = gemini
    ? data?.candidates?.[0]?.content?.parts
        ?.filter((p: { text?: string; thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text || "")
        .join("")
    : data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    recordRequestFailure(messages,'invalid-response',response.status);
    throw new ReplyRequestError(onCompletion&&completionReason(gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason)==='length'?"模型达到输出长度限制，但未返回可保存的文本。":onCompletion?"模型未返回文本，无法确认是否为输出限制或安全拦截。":"模型未返回文本，可能达到输出限制或被安全策略拦截。",replyFailureDetails({httpStatus:response.status,blocked:["SAFETY","RECITATION","PROHIBITED_CONTENT","BLOCKLIST","content_filter"].includes(gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason)||!!data?.promptFeedback?.blockReason}));
  }
  if (content.length > 100000) throw Error("模型响应过长，未保存回复。");
  onCompletion?.(interruption??completionReason(gemini?data?.candidates?.[0]?.finishReason:data?.choices?.[0]?.finish_reason));
  recordRequestResponse(messages,content);
  // Never display credential echoes even from a misconfigured upstream.
  return key ? content.split(key).join("[凭据已隐藏]") : content;
}

/** Opt-in metadata for chat; existing Story/summary string contracts are unchanged. */
export async function requestChatReply(c:ApiConfig,key:string,messages:ContextMessage[],signal:AbortSignal,transport:ApiTransport=browserTransport){
 let interruption:ReplyInterruption|undefined;
 const text=await requestReply(c,key,messages,signal,transport,true,reason=>{interruption=reason;});
 return {text,interruption};
}
