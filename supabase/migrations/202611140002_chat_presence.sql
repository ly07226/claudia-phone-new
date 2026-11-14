-- Active chat presence used only to suppress redundant system notifications.
-- This is a best-effort signal, not proof that a message has been read.
create table if not exists public.claudia_chat_presence (
 user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id text not null,
 last_seen_at timestamptz not null default now(),
 primary key(user_id,conversation_id),
 constraint claudia_presence_conversation_length check(length(conversation_id) between 1 and 128)
);
create index if not exists claudia_chat_presence_recent_idx
 on public.claudia_chat_presence(user_id,last_seen_at desc);
revoke all on public.claudia_chat_presence from anon,authenticated;
alter table public.claudia_chat_presence enable row level security;
comment on table public.claudia_chat_presence is 'Server-only short-lived foreground presence for suppressing Web Push.';
