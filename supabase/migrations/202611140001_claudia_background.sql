-- Claudia Phone background messaging: initial durable storage.
-- Apply only to the dedicated Claudia Phone Supabase project after review.
-- No service keys or provider credentials belong in this migration.
begin;

create table if not exists public.claudia_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claudia_push_endpoint_https check (
    length(endpoint) between 20 and 2048 and left(endpoint, 8) = 'https://'
  ),
  constraint claudia_push_p256dh_length check (length(p256dh) between 40 and 256),
  constraint claudia_push_auth_length check (length(auth_secret) between 16 and 256),
  unique (user_id, endpoint)
);
create index if not exists claudia_push_subscriptions_owner_idx
  on public.claudia_push_subscriptions(user_id);

create table if not exists public.claudia_background_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  client_message_id text not null,
  timeline_id text not null,
  timeline_epoch bigint not null check (timeline_epoch >= 0),
  idempotency_key text not null,
  kind text not null check (kind in ('reply','proactive')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','notified','failed','cancelled','expired')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint claudia_job_idempotency_unique unique (user_id, idempotency_key),
  constraint claudia_job_key_length check (
    length(conversation_id) between 1 and 128
    and length(client_message_id) between 1 and 128
    and length(timeline_id) between 1 and 128
    and length(idempotency_key) between 8 and 200
  )
);
create index if not exists claudia_jobs_claim_idx
  on public.claudia_background_jobs(next_attempt_at, created_at)
  where status = 'queued';
create index if not exists claudia_jobs_owner_idx
  on public.claudia_background_jobs(user_id, created_at desc);

create table if not exists public.claudia_background_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null unique references public.claudia_background_jobs(id) on delete cascade,
  conversation_id text not null,
  message_id text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index if not exists claudia_replies_sync_idx
  on public.claudia_background_replies(user_id, created_at, id);

create table if not exists public.claudia_proactive_schedules (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  enabled boolean not null default false,
  due_at timestamptz,
  probability integer not null default 100 check (probability between 0 and 100),
  schedule_version bigint not null default 0 check (schedule_version >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id),
  constraint claudia_schedule_conversation_length check (length(conversation_id) between 1 and 128)
);
create index if not exists claudia_schedules_due_idx
  on public.claudia_proactive_schedules(due_at)
  where enabled = true;

-- Explicit grants: never rely on Supabase's automatic new-table exposure.
revoke all on public.claudia_push_subscriptions,
  public.claudia_background_jobs,
  public.claudia_background_replies,
  public.claudia_proactive_schedules from anon, authenticated;
grant select on public.claudia_background_jobs,
  public.claudia_background_replies,
  public.claudia_proactive_schedules to authenticated;
-- Subscription secrets and all writes are intentionally server-only.
-- Server functions authenticate callers before using service_role.

alter table public.claudia_push_subscriptions enable row level security;
alter table public.claudia_background_jobs enable row level security;
alter table public.claudia_background_replies enable row level security;
alter table public.claudia_proactive_schedules enable row level security;

create policy "claudia_jobs_owner_read" on public.claudia_background_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "claudia_replies_owner_read" on public.claudia_background_replies
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "claudia_schedules_owner_read" on public.claudia_proactive_schedules
  for select to authenticated using ((select auth.uid()) = user_id);

comment on table public.claudia_push_subscriptions is
  'Server-only: Web Push endpoint and encryption material must not be exposed through client Data API.';
comment on table public.claudia_background_jobs is
  'Server-owned job state. Clients can read only their own job metadata.';
comment on table public.claudia_background_replies is
  'Completed server replies; user-scoped sync with stable message IDs.';
commit;
