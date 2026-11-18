-- QQ cloud data, independent of WeChat and owned by the same Supabase Auth identity.
create table if not exists public.claudia_qq_bindings (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 character_id text not null,
 conversation_id text not null,
 status text not null default 'pending' check(status in ('pending','connected','disconnected','error')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,conversation_id)
);
create table if not exists public.claudia_qq_login_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 conversation_id text not null,
 character_id text not null,
 bridge_attempt_id uuid,
 status text not null default 'waiting',
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(user_id,conversation_id)
);
create table if not exists public.claudia_qq_credentials (
 binding_id uuid primary key references public.claudia_qq_bindings(id) on delete cascade,
 app_id_ciphertext text not null,
 app_secret_ciphertext text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.claudia_qq_ai_profiles (
 binding_id uuid primary key references public.claudia_qq_bindings(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 system_prompt text not null default '',
 model text not null default '',
 endpoint text not null default '',
 api_key_ciphertext text,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.claudia_qq_context_snapshots (
 binding_id uuid primary key references public.claudia_qq_bindings(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 context_messages jsonb not null default '[]'::jsonb,
 revision uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now()
);
create table if not exists public.claudia_qq_messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 binding_id uuid not null references public.claudia_qq_bindings(id) on delete cascade,
 external_message_id text not null,
 direction text not null check(direction in ('inbound','outbound')),
 body text not null,
 status text not null default 'received',
 local_message_id text,
 received_at timestamptz not null default now(),
 unique(binding_id,external_message_id,direction)
);
create index if not exists claudia_qq_messages_owner_cursor on public.claudia_qq_messages(user_id,binding_id,received_at,id);
alter table public.claudia_qq_bindings enable row level security;
alter table public.claudia_qq_login_attempts enable row level security;
alter table public.claudia_qq_credentials enable row level security;
alter table public.claudia_qq_ai_profiles enable row level security;
alter table public.claudia_qq_context_snapshots enable row level security;
alter table public.claudia_qq_messages enable row level security;
-- Browser data access is via authenticated Edge Functions, not direct table grants.
revoke all on public.claudia_qq_bindings,public.claudia_qq_login_attempts,public.claudia_qq_credentials,public.claudia_qq_ai_profiles,public.claudia_qq_context_snapshots,public.claudia_qq_messages from anon,authenticated;

create unique index if not exists claudia_qq_bridge_attempt_unique on public.claudia_qq_login_attempts(bridge_attempt_id) where bridge_attempt_id is not null;
