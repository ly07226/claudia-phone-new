-- Claudia Phone: WeChat daily-chat bridge persistence, schema only.
-- Apply manually after review; this migration does not activate a worker or store credentials.
create table if not exists public.claudia_wechat_bindings (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 character_id text not null check (length(character_id) between 1 and 128),
 conversation_id text not null check (length(conversation_id) between 1 and 128),
 status text not null default 'pending' check (status in ('pending','connected','expired','paused','error','unbound')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id, conversation_id)
);
create index if not exists claudia_wechat_bindings_owner_idx on public.claudia_wechat_bindings(user_id,status);

create table if not exists public.claudia_wechat_messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 binding_id uuid not null references public.claudia_wechat_bindings(id) on delete cascade,
 external_message_id text not null check (length(external_message_id) between 1 and 256),
 direction text not null check (direction in ('inbound','outbound')),
 body text not null check (char_length(body) between 1 and 8000),
 status text not null default 'received' check (status in ('received','processing','generated','sending','sent','failed','unknown')),
 local_message_id text check (local_message_id is null or length(local_message_id) between 1 and 128),
 received_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 lease_until timestamptz,
 attempts integer not null default 0 check (attempts between 0 and 20),
 error_code text,
 unique(binding_id,direction,external_message_id),
 unique(binding_id,local_message_id),
 unique(id,binding_id)
);
create index if not exists claudia_wechat_messages_sync_idx on public.claudia_wechat_messages(user_id,binding_id,received_at,id);
create index if not exists claudia_wechat_messages_work_idx on public.claudia_wechat_messages(status,lease_until) where status in ('received','processing','generated','sending');

-- Enforce that a message's owner is exactly its binding owner, including service-role writes.
create or replace function public.claudia_wechat_assert_message_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
 if not exists (select 1 from public.claudia_wechat_bindings b where b.id=new.binding_id and b.user_id=new.user_id)
 then raise exception 'wechat binding owner mismatch' using errcode='23514'; end if;
 return new;
end; $$;
drop trigger if exists claudia_wechat_message_owner on public.claudia_wechat_messages;
create trigger claudia_wechat_message_owner before insert or update of binding_id,user_id
on public.claudia_wechat_messages for each row execute function public.claudia_wechat_assert_message_owner();

alter table public.claudia_wechat_bindings enable row level security;
alter table public.claudia_wechat_messages enable row level security;
revoke all on public.claudia_wechat_bindings from anon,authenticated;
revoke all on public.claudia_wechat_messages from anon,authenticated;
grant select on public.claudia_wechat_bindings to authenticated;
grant select on public.claudia_wechat_messages to authenticated;
drop policy if exists claudia_wechat_bindings_read on public.claudia_wechat_bindings;
create policy claudia_wechat_bindings_read on public.claudia_wechat_bindings
for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists claudia_wechat_messages_read on public.claudia_wechat_messages;
create policy claudia_wechat_messages_read on public.claudia_wechat_messages
for select to authenticated using (user_id=(select auth.uid()));

-- Deliberately no client insert/update/delete policy.
-- Bindings, messages, leases and receipts must be written only by authenticated,
-- ownership-checked server endpoints using service role.
-- Never put iLink tokens, context_token, API keys, or QR login secrets in these tables.
