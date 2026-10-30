import {
  browserTransport,
  type ApiConfig,
  type ApiTransport,
  type ModelOption,
  type TestResult,
} from "./api";
import { httpFailure, networkFailure } from "./apiDiagnostics";
export function apiBase(value: string) {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|models)$/, "");
}
export interface ModelListResult {
  models: ModelOption[];
  result: TestResult;
  truncated?: boolean;
}
export async function fetchModels(
  c: ApiConfig,
  key: string,
  signal?: AbortSignal,
  transport: ApiTransport = browserTransport,
): Promise<ModelListResult> {
  const base = apiBase(c.baseUrl);
  key = key.trim();
  const failure = (result: TestResult): ModelListResult => ({
    models: [],
    result,
  });
  if (!key)
    return failure({ status: "validation", message: "请先填写 API Key。" });
  try {
    const url = new URL(base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error();
  } catch {
    return failure({
      status: "base-url",
      message: "Base URL 必须为 HTTPS，且不包含账号、查询参数或片段。",
    });
  }
  const gemini =
    c.provider === "gemini" ||
    (c.provider === "custom" && c.protocol === "gemini");
  if (
    !gemini &&
    !["openai", "openai-compatible", "openrouter"].includes(c.provider) &&
    !(c.provider === "custom" && c.protocol === "openai-chat")
  )
    return failure({
      status: "unsupported",
      message: "此 Provider 尚不支持获取模型列表，请选择请求协议或手填 Model。",
    });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 20000);
  try {
    const models = new Map<string, ModelOption>();
    let pageToken = "";
    const seen = new Set<string>();
    let truncated = false;
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${base}/models`);
      if (gemini) {
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
      }
      const response = await transport.send(url.toString(), {
        method: "GET",
        headers: gemini
          ? { "x-goog-api-key": key }
          : { Authorization: `Bearer ${key}` },
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted)
        return failure(networkFailure(true, !!signal?.aborted));
      const error = httpFailure(response.status, data, true);
      if (error) return failure(error);
      const rows = gemini ? data?.models : data?.data;
      if (!Array.isArray(rows))
        return failure({
          status: "unsupported",
          message: "获取模型列表接口未返回支持的格式。请继续手动填写 Model。",
        });
      for (const row of rows) {
        if (
          gemini &&
          (!Array.isArray(row?.supportedGenerationMethods) ||
            !row.supportedGenerationMethods.includes("generateContent"))
        )
          continue;
        const id = gemini
          ? typeof row?.name === "string"
            ? row.name.replace(/^models\//, "")
            : undefined
          : row?.id;
        if (
          typeof id !== "string" ||
          !id ||
          id.length > 200 ||
          id.includes(key)
        )
          continue;
        const name = gemini ? row.displayName : row.name;
        models.set(id, {
          id,
          name:
            typeof name === "string"
              ? name.split(key).join("[凭据已隐藏]").slice(0, 200)
              : undefined,
        });
        if (models.size >= 2000) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
      if (!gemini || !data.nextPageToken) break;
      if (
        typeof data.nextPageToken !== "string" ||
        data.nextPageToken.includes(key) ||
        seen.has(data.nextPageToken)
      ) {
        truncated = true;
        break;
      }
      pageToken = data.nextPageToken;
      seen.add(pageToken);
      if (page === 9) truncated = true;
    }
    return {
      models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)),
      result: {
        status: "success",
        message: models.size
          ? `已获取 ${models.size} 个模型${truncated ? "（达到列表上限）" : ""}，请选择或继续手动填写。`
          : "接口可访问，但未返回可用于文本生成的模型。可继续手动填写 Model。",
      },
      truncated,
    };
  } catch {
    return failure(
      networkFailure(controller.signal.aborted, !!signal?.aborted),
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
