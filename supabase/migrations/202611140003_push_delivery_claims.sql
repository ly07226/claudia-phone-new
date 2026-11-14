-- Claim each completed job's notification once, atomically.
-- Suppressed foreground notifications are not claimed, so this is checked
-- only after foreground presence is checked by the sender.
create table if not exists public.claudia_push_delivery_claims (
 job_id uuid primary key references public.claudia_background_jobs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 claimed_at timestamptz not null default now(),
 sent_count integer not null default 0,
 failed_count integer not null default 0,
 finished_at timestamptz
);
revoke all on public.claudia_push_delivery_claims from anon, authenticated;
alter table public.claudia_push_delivery_claims enable row level security;
comment on table public.claudia_push_delivery_claims is
 'Server-only at-most-once notification claim. No automatic retries after uncertain delivery.';
