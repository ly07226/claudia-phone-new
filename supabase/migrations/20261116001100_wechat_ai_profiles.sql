-- Server-only AI execution package, explicitly uploaded by the owner.
-- Never copy browser API credentials automatically.
create table if not exists public.claudia_wechat_ai_profiles(
 binding_id uuid primary key references public.claudia_wechat_bindings(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 system_prompt text not null check(char_length(system_prompt) between 1 and 24000),
 model text not null check(length(model) between 1 and 128),
 endpoint text not null,
 api_key_ciphertext text not null,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create or replace function public.claudia_wechat_assert_ai_profile_owner()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.claudia_wechat_bindings b
  where b.id=new.binding_id and b.user_id=new.user_id)
 then raise exception 'wechat AI profile owner mismatch' using errcode='23514'; end if;
 return new;
end; $$;
drop trigger if exists claudia_wechat_ai_profile_owner on public.claudia_wechat_ai_profiles;
create trigger claudia_wechat_ai_profile_owner before insert or update
 on public.claudia_wechat_ai_profiles for each row execute function public.claudia_wechat_assert_ai_profile_owner();
alter table public.claudia_wechat_ai_profiles enable row level security;
revoke all on public.claudia_wechat_ai_profiles from anon,authenticated;
-- A privileged, authenticated provisioning function is required before enabling.
-- There is intentionally no public write policy or automatic key transfer.
