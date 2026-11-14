// Authenticated background-job intake. This is a durable QUEUE ONLY.
// It intentionally does not run an AI model or accept API keys.
import { createClient } from "npm:@supabase/supabase-js@2";

const appOrigin = Deno.env.get("CLAUDIA_APP_ORIGIN") || "";
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Vary": "Origin",
  "Access-Control-Allow-Origin": appOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), { status, headers });
const idPattern = /^[a-zA-Z0-9:_-]{1,128}$/;
const keyPattern = /^[a-zA-Z0-9:_-]{8,200}$/;
const isId = (value: unknown) => typeof value === "string" && idPattern.test(value);

Deno.serve(async (request) => {
  if (!appOrigin || request.headers.get("Origin") !== appOrigin) {
    return respond(403, { error: "origin_denied" });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
  const token = request.headers.get("Authorization");
  if (!token?.startsWith("Bearer ")) return respond(401, { error: "unauthorized" });
  // Fail closed: no orphaned queued jobs while the AI executor is unavailable.
  if (Deno.env.get("CLAUDIA_BACKGROUND_EXECUTOR_READY") !== "true" || Deno.env.get("CLAUDIA_BYOK_EXECUTOR_READY") !== "true") {
    return respond(503, { error: "executor_not_ready" });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) return respond(503, { error: "not_configured" });

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: identity, error: authError } = await admin.auth.getUser(token.slice(7));
  if (authError || !identity.user) return respond(401, { error: "unauthorized" });

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 125000) return respond(413, { error: "payload_too_large" });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (!isId(body.conversationId) || !isId(body.clientMessageId) ||
      !isId(body.timelineId) || typeof body.idempotencyKey !== "string" ||
      !keyPattern.test(body.idempotencyKey) || body.kind !== "reply" ||
      !Number.isSafeInteger(body.timelineEpoch) ||
      (body.timelineEpoch as number) < 0 || !Array.isArray(body.messages) ||
      body.messages.length < 1 || body.messages.length > 80 ||
      !body.messages.every((m: unknown) => m && typeof m === 'object' &&
        ['system','user','assistant'].includes((m as {role?:string}).role ?? '') &&
        typeof (m as {content?:unknown}).content === 'string' &&
        ((m as {content:string}).content.length > 0) &&
        ((m as {content:string}).content.length <= 30000))) {
    return respond(400, { error: "invalid_job" });
  }

  // Never substitute the server-managed model for the character-bound BYOK API.
  // Secure credential-envelope support is not yet implemented: reject safely.
  if (body.providerBinding !== "byok-v1") return respond(422, { error: "byok_binding_required" });
  if (Deno.env.get("CLAUDIA_BYOK_KEY_ID") !== body.keyId) return respond(503, { error: "encryption_key_mismatch" });
  if (typeof body.encryptedKey !== "string" || !/^[A-Za-z0-9+/]{128,2048}={0,2}$/.test(body.encryptedKey) ||
      !["gemini","openai","openrouter","openai-compatible","custom"].includes(String(body.provider)) ||
      !["gemini","openai-chat"].includes(String(body.protocol)) ||
      typeof body.model !== "string" || body.model.length < 1 || body.model.length > 200 ||
      typeof body.baseUrl !== "string" || body.baseUrl.length > 512 ||
      typeof body.temperature !== "number" || body.temperature < 0 || body.temperature > 2 ||
      !Number.isInteger(body.maxTokens) || (body.maxTokens as number) < 1 || (body.maxTokens as number) > 32768)
    return respond(400, { error: "invalid_provider_binding" });
  // Only trusted provider origins are allowed in cloud mode (no arbitrary SSRF targets).
  let providerUrl: URL;
  try { providerUrl = new URL(body.baseUrl as string); } catch { return respond(400, { error: "invalid_provider_url" }); }
  if (providerUrl.protocol !== "https:" || providerUrl.username || providerUrl.password || providerUrl.search || providerUrl.hash ||
      !["generativelanguage.googleapis.com","api.openai.com","openrouter.ai"].includes(providerUrl.hostname))
    return respond(422, { error: "unsupported_cloud_provider_origin" });
  // Verified user ID only. Store the immutable prompt atomically with the job.
  // This mode uses the server operator's managed model, never the user's BYOK key.
  const {data:jobId,error:enqueueError}=await admin.rpc('claudia_enqueue_byok',{
    p_user_id:identity.user.id,p_conversation_id:body.conversationId,
    p_client_message_id:body.clientMessageId,p_timeline_id:body.timelineId,
    p_timeline_epoch:body.timelineEpoch,p_idempotency_key:body.idempotencyKey,
    p_messages:body.messages,p_key_id:body.keyId,p_encrypted_key:body.encryptedKey,
    p_provider:body.provider,p_protocol:body.protocol,p_base_url:body.baseUrl,
    p_model:body.model,p_temperature:body.temperature,p_max_tokens:body.maxTokens
  });
  if(enqueueError||typeof jobId!=='string')return respond(409,{error:'enqueue_rejected'});
  return respond(202,{ok:true,jobId,status:'queued'});
});
