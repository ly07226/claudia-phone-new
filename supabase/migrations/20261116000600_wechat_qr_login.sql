-- QR login attempts are owned by a Supabase user and never readable by browser SQL.
create table if not exists public.claudia_wechat_login_attempts(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id text not null check(length(conversation_id) between 1 and 128),
 character_id text not null check(length(character_id) between 1 and 128),
 qr_token_ciphertext text not null,
 status text not null default 'wait' check(status in ('wait','scaned','confirmed','expired','failed','need_verifycode')),
 expires_at timestamptz not null default(now()+interval '5 minutes'),
 created_at timestamptz not null default now(),
 unique(user_id,conversation_id)
);
create table if not exists public.claudia_wechat_credentials(
 binding_id uuid primary key references public.claudia_wechat_bindings(id) on delete cascade,
 bot_token_ciphertext text not null,
 bot_id text not null,
 user_identifier_ciphertext text,
 api_base_url text not null,
 created_at timestamptz not null default now()
);
alter table public.claudia_wechat_login_attempts enable row level security;
alter table public.claudia_wechat_credentials enable row level security;
revoke all on public.claudia_wechat_login_attempts from anon,authenticated;
revoke all on public.claudia_wechat_credentials from anon,authenticated;
-- No client RLS policies: all access through authenticated Edge Functions using service role.
