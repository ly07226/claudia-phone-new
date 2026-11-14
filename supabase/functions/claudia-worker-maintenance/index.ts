// Internal-only queue maintenance: expire stale unprocessable jobs.
// This does not claim to generate AI responses. No provider credentials are
// available to this worker until a secure per-user provider architecture exists.
// Deploy with verify_jwt=false ONLY with a strong internal secret configured.
import { createClient } from "npm:@supabase/supabase-js@2";
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
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return respond(503, { error: "not_configured" });
  const admin = createClient(url, key, { auth: {
    persistSession: false, autoRefreshToken: false,
  } });
  // Current intake accepts metadata only, so queued work cannot be generated.
  // Explicit expiry avoids pretending a pending job is still being processed.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from("claudia_background_jobs")
    .update({ status: "expired", error_code: "worker_not_configured",
      updated_at: new Date().toISOString() })
    .eq("status", "queued").lt("created_at", cutoff)
    .select("id").limit(100);
  if (error) return respond(500, { error: "maintenance_failed" });
  return respond(200, { ok: true, expired: data?.length ?? 0,
    aiExecutionReady: false });
});
