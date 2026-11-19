-- Per-binding durable iLink polling cursor. Only server workers can access it.
create table if not exists public.claudia_wechat_poll_cursors(
 binding_id uuid primary key references public.claudia_wechat_bindings(id) on delete cascade,
 get_updates_buf text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.claudia_wechat_poll_cursors enable row level security;
revoke all on public.claudia_wechat_poll_cursors from anon,authenticated;
-- A single worker per personal Supabase project is required for the initial version.
-- Do not run multiple replicas without a distributed lease.
