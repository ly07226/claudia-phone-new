// Supabase Edge Function: authenticated Web Push subscription registry.
// Deploy as /functions/v1/claudia-push-subscriptions with JWT verification enabled.
// This function stores subscriptions only. It does NOT send Web Push.
import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const allowedOrigin = Deno.env.get("CLAUDIA_APP_ORIGIN") || "";
function corsHeaders() { return { ...jsonHeaders, "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS" }; }
const MAX_BODY = 8192;

function reply(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
function validSubscription(value: unknown): value is {
  endpoint: string; keys: { p256dh: string; auth: string };
} {
  if (!value || typeof value !== "object") return false;
  const sub = value as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || sub.endpoint.length > 2048) return false;
  try {
    const url = new URL(sub.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
    // Do not allow loopback/local IPs or private hostnames as push destinations.
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || !host.includes(".")) return false;
  } catch { return false; }
  if (!sub.keys || typeof sub.keys !== "object") return false;
  const keys = sub.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && /^[A-Za-z0-9_-]{40,256}$/.test(keys.p256dh) &&
    typeof keys.auth === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(keys.auth);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (!allowedOrigin || !origin || origin !== allowedOrigin) return reply(403, { error: "origin_denied" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== "POST" && request.method !== "DELETE") {
    return reply(405, { error: "method_not_allowed" });
  }
  // Supabase Edge Functions are hosted on a separate origin; use bearer JWT,
  // never cookies or permissive CORS. Browser callers must be from an allowed origin.
  const bearer = request.headers.get("Authorization");
  if (!bearer?.startsWith("Bearer ")) return reply(401, { error: "unauthorized" });
  const size = Number(request.headers.get("Content-Length") || "0");
  if (size > MAX_BODY) return reply(413, { error: "payload_too_large" });
  let raw: string;
  try {
    raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: "payload_too_large" });
  } catch { return reply(400, { error: "invalid_body" }); }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    body = parsed as Record<string, unknown>;
  } catch { return reply(400, { error: "invalid_json" }); }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(503, { error: "not_configured" });
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: identity, error: identityError } = await admin.auth.getUser(bearer.slice(7));
  if (identityError || !identity.user) return reply(401, { error: "unauthorized" });
  const userId = identity.user.id;

  if (request.method === "POST") {
    if (!validSubscription(body.subscription)) return reply(400, { error: "invalid_subscription" });
    const subscription = body.subscription;
    const { error } = await admin.from("claudia_push_subscriptions").upsert({
      user_id: userId, endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh, auth_secret: subscription.keys.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,endpoint" });
    if (error) return reply(500, { error: "storage_failed" });
    return reply(200, { ok: true });
  }

  if (typeof body.endpoint !== "string" || body.endpoint.length > 2048) {
    return reply(400, { error: "invalid_endpoint" });
  }
  const { error } = await admin.from("claudia_push_subscriptions")
    .delete().eq("user_id", userId).eq("endpoint", body.endpoint);
  if (error) return reply(500, { error: "storage_failed" });
  return reply(200, { ok: true });
});
