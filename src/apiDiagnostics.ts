import type { TestResult } from "./api";
export function httpFailure(
  status: number,
  data: unknown,
  models = false,
): TestResult | null {
  const error = (
    data as {
      error?: {
        code?: unknown;
        status?: unknown;
        message?: unknown;
        details?: unknown;
      };
    }
  )?.error;
  // Inspect only for classification; never return provider-supplied text.
  const marker = JSON.stringify([
    error?.code,
    error?.status,
    error?.details,
  ]).toLowerCase();
  if (
    marker.includes("model_not_found") ||
    marker.includes("model_not_available") ||
    marker.includes("model_access_denied")
  )
    return {
      status: "model",
      message: "模型不存在或无权限：请检查模型名称及账户可用模型。",
    };
  if (
    status === 401 ||
    marker.includes("api_key_invalid") ||
    marker.includes("invalid_api_key")
  )
    return {
      status: "authentication",
      message: "API Key 无效或已过期，请检查凭据。",
    };
  if (status === 403)
    return {
      status: "authentication",
      message:
        "认证或权限不足：请检查 API Key、账户权限；所选模型也可能未授权。",
    };
  if (models && [404, 405, 501].includes(status))
    return {
      status: "unsupported",
      message:
        "获取模型列表接口不受支持或 Base URL 路径错误。可继续手动填写 Model，并用测试连接确认。",
    };
  if (status === 404)
    return {
      status: "base-url",
      message:
        "Base URL 接口不存在，或模型不存在/无权限。请核对地址、API 版本和 Model。",
    };
  if (status >= 500)
    return {
      status: "base-url",
      message: `Base URL 服务暂时无法访问（HTTP ${status}），请稍后再试。`,
    };
  if (status === 429)
    return {
      status: "other",
      message: "请求限流或额度不足，请稍后重试并检查账户额度。",
    };
  if (status < 200 || status >= 300 || error)
    return {
      status: "other",
      message: `服务请求失败（HTTP ${status}），请检查配置及服务状态。`,
    };
  return null;
}
export function networkFailure(
  aborted: boolean,
  cancelled: boolean,
): TestResult {
  if (aborted)
    return cancelled
      ? { status: "cancelled", message: "请求已取消。" }
      : { status: "timeout", message: "请求超时：20 秒内未完成，请稍后重试。" };
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return {
      status: "network",
      message: "网络错误：设备当前离线，请连接网络后重试。",
    };
  return {
    status: "network",
    message:
      "浏览器跨域限制（CORS）或网络错误：浏览器未提供可读响应，无法可靠区分跨域、DNS、TLS、重定向或 Base URL 无法访问。请确认服务允许当前网站来源；不能据此判断 API Key 无效。不会使用 CORS 绕过代理。",
  };
}
