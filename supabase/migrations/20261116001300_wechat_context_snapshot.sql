-- Explicitly approved, bounded effective context snapshot from the daily chat engine.
create table if not exists public.claudia_wechat_context_snapshots(
 binding_id uuid primary key references public.claudia_wechat_bindings(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 context_messages jsonb not null,
 revision uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now(),
 constraint context_snapshot_size check(octet_length(context_messages::text)<=80000)
);
alter table public.claudia_wechat_context_snapshots enable row level security;
revoke all on public.claudia_wechat_context_snapshots from anon,authenticated;
create or replace function public.claudia_wechat_check_snapshot_owner()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.claudia_wechat_bindings b
  where b.id=new.binding_id and b.user_id=new.user_id and b.status='connected')
 then raise exception 'invalid snapshot owner' using errcode='23514';end if;
 return new;
end; $$;
create trigger claudia_wechat_snapshot_owner before insert or update
 on public.claudia_wechat_context_snapshots for each row
 execute function public.claudia_wechat_check_snapshot_owner();
