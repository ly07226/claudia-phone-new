// Internal-only background worker readiness endpoint.
// Never silently expire a user's queued message: failure and timeout handling
// belong to the actual worker, with immediate persisted terminal states.
// This endpoint is intentionally non-mutating until a real worker exists.
const respond = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  } });
Deno.serve(async request => {
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
  const secret = Deno.env.get("CLAUDIA_INTERNAL_WORKER_SECRET");
  if (!secret || secret.length < 32) return respond(503, { error: "not_configured" });
  if (request.headers.get("Authorization") !== "Bearer " + secret) {
    return respond(401, { error: "unauthorized" });
  }
  return respond(503, {
    error: "worker_not_implemented",
    aiExecutionReady: false,
    message: "后台 AI 执行器尚未部署；禁止将排队任务伪装为处理中或静默过期。",
  });
});
