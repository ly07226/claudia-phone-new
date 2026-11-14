# Background replies and iOS Web Push: implementation contract

Status: architecture specification only. The repository currently has no authenticated backend, persistent database, worker, or deployed Web Push sender. Client-only notifications are best effort and do not survive iOS process suspension.

## Required infrastructure
- Authenticated same-origin API, e.g. /api/push/subscriptions and /api/jobs.
- Durable database for users, devices, subscriptions, encrypted provider credentials, jobs, and completed replies.
- Independent worker/queue or scheduled job runner; a browser timer and a short-lived HTTP request are not reliable background workers.
- VAPID key pair generated and stored as server secrets; only the public key is exposed to the client.
- Authentication and CSRF protection for subscription writes; per-user authorization for all jobs and results. Never use endpoint alone as proof of device ownership.
- Encrypt provider keys at rest using a server-only key. Explicit opt-in is required to migrate any existing browser-local credentials. Never include credentials in PushSubscription, push payload, logs, or analytics.
- Do not allow user-controlled arbitrary API base URLs from the worker without SSRF controls (HTTPS, approved hosts, DNS/IP restrictions, redirect checks).
- Explicit opt-in to server processing of chat context; privacy disclosure, retention, delete/revoke controls.

## Contract
POST /api/push/subscriptions: authenticated JSON {subscription}; validate HTTPS endpoint, p256dh/auth, request size, ownership, idempotently upsert. Return 200 only after durable write.
DELETE /api/push/subscriptions: authenticated JSON {endpoint}; revoke only caller-owned subscription, idempotent.
POST /api/jobs: authenticated JSON {conversationId, clientMessageId, timelineId, epoch, idempotencyKey}; no provider key in body. Validate ownership, authorization, context version, server credential opt-in. Persist queued job before returning 202.
GET /api/jobs/:id: authenticated, owner-only, return status and sanitized result metadata.
GET /api/sync?cursor=...: authenticated, owner-only, return completed messages and tombstones with stable IDs. Client must reconcile against local Dexie without duplicating messages.

## State machine
queued -> running -> completed -> notified, with failed/cancelled/expired terminal states. Atomic claim and unique (userId, idempotencyKey). Enforce one active generation per conversation/path and check timeline epoch before commit. Retry only transient failures, with bounded exponential backoff. Do not regenerate on push delivery retry.

## Notification delivery
Worker commits assistant reply first, then sends Web Push using the owner's active subscriptions. Payload: title, short preview, conversationId, messageId, and URL token-free. Handle 404/410 subscriptions by revocation. Notification click should route to the conversation after authentication and sync; never expose keys or full sensitive context in URL.

## Long-term proactive messages
Durable per-conversation schedule, not browser visibility. A periodic worker claims due conversations atomically, rechecks enabled flag, latest user activity, probability, active job, and attempt key, then generates and notifies. Editing or disabling settings invalidates future jobs. A failed AI request must have a bounded retry policy rather than permanently consuming the attempt.

## Rollout and validation
1. Choose hosting, authenticated database and worker, and cost/quotas.
2. Add secure backend endpoints and tests; no unauthenticated registration or job execution.
3. Add explicit background-credential opt-in and encrypted storage.
4. Migrate ordinary daily replies to server jobs with local fallback and deterministic sync.
5. Test actual iPhone home-screen PWA: send -> switch apps/lock -> complete -> system banner -> tap -> correct chat, including offline, revoked permission, duplicate submissions, stale timeline, cancellation and key revocation.
6. Enable proactive worker only after ordinary reply delivery is verified.

Deployment and real-device tests require user-approved infrastructure and configuration. Do not claim the end-to-end feature is complete based on frontend code or GitHub comment checks.
