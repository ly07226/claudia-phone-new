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
  if (Deno.env.get("CLAUDIA_BACKGROUND_EXECUTOR_READY") !== "true") {
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
    if (raw.length > 4096) return respond(413, { error: "payload_too_large" });
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
      (body.timelineEpoch as number) < 0) {
    return respond(400, { error: "invalid_job" });
  }

  // User ID is ALWAYS derived from the verified JWT, never request JSON.
  // Conflict does not enqueue another run of the same logical message.
  const row = {
    user_id: identity.user.id,
    conversation_id: body.conversationId,
    client_message_id: body.clientMessageId,
    timeline_id: body.timelineId,
    timeline_epoch: body.timelineEpoch,
    idempotency_key: body.idempotencyKey,
    kind: "reply",
  };
  const { data: inserted, error: insertError } = await admin
    .from("claudia_background_jobs")
    .upsert(row, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true })
    .select("id,status")
    .maybeSingle();
  if (insertError) return respond(500, { error: "enqueue_failed" });
  if (inserted) return respond(202, { ok: true, jobId: inserted.id, status: inserted.status });
  const { data: existing, error: readError } = await admin
    .from("claudia_background_jobs").select("id,status")
    .eq("user_id", identity.user.id).eq("idempotency_key", body.idempotencyKey).maybeSingle();
  if (readError || !existing) return respond(500, { error: "lookup_failed" });
  return respond(200, { ok: true, jobId: existing.id, status: existing.status, duplicate: true });
});
