import {
  validateConfig,
  type ApiConfig,
  type ApiTransport,
  browserTransport,
} from "./api";
import type { ContextMessage } from "./chatTypes";
/** Direct browser transport: no public arbitrary-URL server proxy is exposed. */
export async function requestReply(
  c: ApiConfig,
  key: string,
  messages: ContextMessage[],
  signal: AbortSignal,
  transport: ApiTransport = browserTransport,
): Promise<string> {
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
  const body = gemini
    ? {
        systemInstruction: { parts: [{ text: messages[0].content }] },
        contents: messages
          .slice(1)
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        generationConfig: {
          temperature: c.temperature,
          maxOutputTokens: c.maxTokens,
        },
      }
    : {
        model: c.model,
        messages,
        temperature: c.temperature,
        ...(c.provider === "openai"
          ? { max_completion_tokens: c.maxTokens }
          : { max_tokens: c.maxTokens }),
        stream: false,
      };
  let response: Response;
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
    throw Error(
      signal.aborted
        ? "请求已取消或超时，已保存的消息不会丢失。"
        : "网络请求失败，可能是网络、CORS、TLS 或重定向限制。服务必须支持浏览器直连；请勿使用不可信公共代理。",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("服务响应不是有效 JSON，请检查接口地址。");
  }
  if (!response.ok || data?.error)
    throw Error(
      response.status === 401 || response.status === 403
        ? "API 认证失败，请检查 Key 和权限。"
        : response.status === 429
          ? "额度不足或请求过于频繁，请稍后再试。"
          : response.status === 404
            ? "模型或接口不存在，请检查 Model 和 Base URL。"
            : `模型请求失败（HTTP ${response.status}），请检查参数和服务状态。`,
    );
  const content = gemini
    ? data?.candidates?.[0]?.content?.parts
        ?.filter((p: { text?: string; thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text || "")
        .join("")
    : data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw Error("模型未返回文本，可能达到输出限制或被安全策略拦截。");
  if (content.length > 100000) throw Error("模型响应过长，未保存回复。");
  // Never display credential echoes even from a misconfigured upstream.
  return key ? content.split(key).join("[凭据已隐藏]") : content;
}
