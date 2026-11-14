// Internal-only Web Push delivery endpoint. NOT callable with an anonymous user JWT.
// Deploy with JWT verification disabled ONLY after configuring CLAUDIA_INTERNAL_PUSH_SECRET.
// Call from trusted server workers with Authorization: Bearer <internal secret>.
// Does not accept arbitrary endpoints or message bodies from public clients.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = /^[a-zA-Z0-9:_-]{1,128}$/;
const validSecret = (s: string | undefined) => !!s && s.length >= 32;

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const secret = Deno.env.get("CLAUDIA_INTERNAL_PUSH_SECRET");
  if (!validSecret(secret)) return json(503, { error: "not_configured" });
  const token = request.headers.get("Authorization");
  if (token !== "Bearer " + secret) return json(401, { error: "unauthorized" });

  const url = Deno.env.get("SUPABASE_URL");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("CLAUDIA_VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("CLAUDIA_VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("CLAUDIA_VAPID_SUBJECT");
  if (!url || !adminKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    return json(503, { error: "not_configured" });
  }
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return json(413, { error: "payload_too_large" });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    input = parsed as Record<string, unknown>;
  } catch { return json(400, { error: "invalid_json" }); }
  if (typeof input.jobId !== "string" || !uuid.test(input.jobId)) {
    return json(400, { error: "invalid_job_id" });
  }
  const admin = createClient(url, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: job, error: jobError } = await admin.from("claudia_background_jobs")
    .select("id,user_id,conversation_id,status").eq("id", input.jobId).maybeSingle();
  if (jobError) return json(500, { error: "job_lookup_failed" });
  if (!job || !["completed", "notified"].includes(job.status) ||
      typeof job.conversation_id !== "string" || !id.test(job.conversation_id)) {
    return json(404, { error: "completed_job_not_found" });
  }
  const { data: reply } = await admin.from("claudia_background_replies")
    .select("id").eq("job_id", job.id).eq("user_id", job.user_id).maybeSingle();
  if (!reply) return json(409, { error: "reply_not_saved" });
  // Suppress lock-screen/banner notifications while this conversation is
  // actively open. A heartbeat older than 30s does not count as foreground.
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data: presence, error: presenceError } = await admin
    .from("claudia_chat_presence").select("last_seen_at")
    .eq("user_id", job.user_id).eq("conversation_id", job.conversation_id)
    .gte("last_seen_at", since).maybeSingle();
  // Fail closed on push if presence cannot be checked: no accidental
  // foreground banner; the reply remains persisted for later sync.
  if (presenceError) return json(503, { error: "presence_unavailable" });
  if (presence) return json(200, { ok: true, suppressed: "foreground_chat" });
  const { data: subs, error: subsError } = await admin.from("claudia_push_subscriptions")
    .select("id,endpoint,p256dh,auth_secret").eq("user_id", job.user_id).limit(20);
  if (subsError) return json(500, { error: "subscription_lookup_failed" });
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  // No AI response text is included in push payload, including on lock screens.
  const payload = JSON.stringify({
    title: "Claudia Phone",
    body: "角色回复已完成，点击查看。",
    conversationId: job.conversation_id,
  });
  let sent = 0, failed = 0, expired = 0;
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
      }, payload, { TTL: 300 });
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        expired++;
        await admin.from("claudia_push_subscriptions").delete()
          .eq("id", sub.id).eq("user_id", job.user_id);
      } else failed++;
    }
  }
  // A notification is best-effort: preserve the saved reply regardless of delivery.
  // Do not change job.status to notified here; retries need a separate delivery ledger.
  return json(200, { ok: true, sent, failed, expired });
});
