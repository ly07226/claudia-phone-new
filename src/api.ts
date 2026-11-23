import { httpFailure, networkFailure } from "./apiDiagnostics";
/** Metadata deliberately excludes credentials. Unknown provider IDs remain extensible. */
export interface ApiConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Optional explicitly supplied model metadata; never inferred from its name. */
  contextWindowTokens?: number;
  modelOutputTokens?: number;
  enabled: boolean;
  isDefault: boolean;
  protocol?: "openai-chat" | "gemini" | "unsupported";
  createdAt: number;
  updatedAt: number;
}
export interface ApiCredential {
  configId: string;
  apiKey: string;
}
export interface ModelOption {
  contextWindowTokens?:number;
  modelOutputTokens?:number;
  id: string;
  name?: string;
}
export type TestStatus =
  | "timeout"
  | "cancelled"
  | "testing"
  | "success"
  | "validation"
  | "authentication"
  | "network"
  | "base-url"
  | "model"
  | "unsupported"
  | "other";
export interface TestResult {
  status: TestStatus;
  message: string;
}
export interface ProviderAdapter {
  label: string;
  defaultUrl: string;
  request?: (c: ApiConfig, key: string) => { url: string; init: RequestInit };
  // Future model discovery; no network request is made for this in phase 2.1.
  listModels?: (
    config: ApiConfig,
    key: string,
    signal: AbortSignal,
  ) => Promise<ModelOption[]>;
}
function chat(c: ApiConfig, key: string) {
  return {
    url: `${c.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: "user", content: "Hi" }],
        ...(c.provider === "openai"
          ? { max_completion_tokens: 1 }
          : { max_tokens: 1 }),
        stream: false,
      }),
    },
  };
}
function gemini(c: ApiConfig, key: string) {
  return {
    url: `${c.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(c.model.replace(/^models\//, ""))}:generateContent`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    },
  };
}
export const providers: Record<string, ProviderAdapter> = {
  "openai-compatible": {
    label: "OpenAI Compatible",
    defaultUrl: "",
    request: chat,
  },
  openai: {
    label: "OpenAI",
    defaultUrl: "https://api.openai.com/v1",
    request: chat,
  },
  gemini: {
    label: "Google Gemini",
    defaultUrl: "https://generativelanguage.googleapis.com/v1beta",
    request: gemini,
  },
  openrouter: {
    label: "OpenRouter",
    defaultUrl: "https://openrouter.ai/api/v1",
    request: chat,
  },
  custom: { label: "Custom", defaultUrl: "" },
};
export function validateConfig(c: ApiConfig, key: string): string | null {
  if (!c.name.trim() || !c.model.trim() || !key.trim())
    return "请填写配置名称、API Key 和 Model。";
  try {
    const url = new URL(c.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "Base URL 必须是 HTTPS 地址，且不能包含账号、查询参数或片段。";
  } catch {
    return "请输入有效的 Base URL。";
  }
  if (!Number.isFinite(c.temperature) || c.temperature < 0 || c.temperature > 2)
    return "Temperature 需为 0–2。";
  if (
    !Number.isSafeInteger(c.maxTokens) ||
    c.maxTokens < 1 ||
    c.maxTokens > 1000000
  )
    return "Max Tokens 需为 1–1000000 的整数。";
  if (c.isDefault && !c.enabled) return "默认配置必须启用。";
  return null;
}
/** A future authenticated proxy can implement this boundary without changing provider adapters. */
export interface ApiTransport {
  send(url: string, init: RequestInit): Promise<Response>;
}
export const browserTransport: ApiTransport = {
  send: (url, init) => fetch(url, init),
};
export async function testConnection(
  c: ApiConfig,
  key: string,
  signal?: AbortSignal,
  transport: ApiTransport = browserTransport,
): Promise<TestResult> {
  const validation = validateConfig(c, key);
  if (validation)
    return {
      status:
        c.baseUrl && /Base URL/.test(validation) ? "base-url" : "validation",
      message: validation,
    };
  if (!c.enabled) return { status: "validation", message: "请先启用该配置。" };
  const adapter =
    c.provider === "custom"
      ? c.protocol === "openai-chat"
        ? chat
        : c.protocol === "gemini"
          ? gemini
          : undefined
      : providers[c.provider]?.request;
  if (!adapter)
    return {
      status: "unsupported",
      message:
        "Provider 不支持当前测试方式，请为 Custom 选择协议或等待后端代理支持。",
    };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(cancel, 20000);
  try {
    const request = adapter(c, key);
    const response = await transport.send(request.url, {
      ...request.init,
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    // Never surface provider response text: it can echo submitted credentials.
    const data = await response.json().catch(() => null);
    if (controller.signal.aborted)
      return networkFailure(true, !!signal?.aborted);
    const failure = httpFailure(response.status, data);
    if (failure) return failure;
    const valid =
      c.provider === "gemini" ||
      (c.provider === "custom" && c.protocol === "gemini")
        ? Array.isArray(data?.candidates)
        : Array.isArray(data?.choices);
    return valid
      ? { status: "success", message: "连接成功：服务已返回有效模型响应。" }
      : {
          status: "other",
          message: "响应格式不符合所选协议，请检查 Base URL 和 Provider。",
        };
  } catch {
    return networkFailure(controller.signal.aborted, !!signal?.aborted);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
