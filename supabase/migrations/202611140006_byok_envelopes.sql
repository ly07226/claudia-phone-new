-- Per-job BYOK envelope. Ciphertext only; never persist plaintext credentials.
begin;
create table if not exists public.claudia_job_credentials (
 job_id uuid primary key references public.claudia_background_jobs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 key_id text not null check (length(key_id) between 1 and 80),
 encrypted_key text not null check (length(encrypted_key) between 128 and 2048),
 provider text not null check (provider in ('gemini','openai','openrouter','openai-compatible','custom')),
 protocol text not null check (protocol in ('gemini','openai-chat')),
 base_url text not null check (length(base_url) between 10 and 512),
 model text not null check (length(model) between 1 and 200),
 temperature numeric not null check (temperature between 0 and 2),
 max_tokens integer not null check (max_tokens between 1 and 32768),
 created_at timestamptz not null default now()
);
revoke all on public.claudia_job_credentials from anon,authenticated;
alter table public.claudia_job_credentials enable row level security;
create index if not exists claudia_job_credentials_owner_idx on public.claudia_job_credentials(user_id);
comment on table public.claudia_job_credentials is 'Server-only RSA-OAEP encrypted BYOK per job; private key stays in Edge Function secrets.';
-- Require both prompt and encrypted provider binding atomically; never enqueue a half-configured task.
create or replace function public.claudia_enqueue_byok(
 p_user_id uuid,p_conversation_id text,p_client_message_id text,p_timeline_id text,
 p_timeline_epoch bigint,p_idempotency_key text,p_messages jsonb,
 p_key_id text,p_encrypted_key text,p_provider text,p_protocol text,
 p_base_url text,p_model text,p_temperature numeric,p_max_tokens integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_old public.claudia_background_jobs%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 if p_messages is null or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages) not between 1 and 80 or octet_length(p_messages::text)>120000 then raise exception 'invalid_context'; end if;
 insert into public.claudia_background_jobs(user_id,conversation_id,client_message_id,timeline_id,timeline_epoch,idempotency_key,kind)
 values(p_user_id,p_conversation_id,p_client_message_id,p_timeline_id,p_timeline_epoch,p_idempotency_key,'reply')
 on conflict(user_id,idempotency_key) do nothing returning id into v_id;
 if v_id is null then
  select * into v_old from public.claudia_background_jobs where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if not found or v_old.conversation_id<>p_conversation_id or v_old.client_message_id<>p_client_message_id or v_old.timeline_id<>p_timeline_id or v_old.timeline_epoch<>p_timeline_epoch then raise exception 'idempotency_conflict'; end if;
  return v_old.id;
 end if;
 insert into public.claudia_job_contexts(job_id,user_id,messages) values(v_id,p_user_id,p_messages);
 insert into public.claudia_job_credentials(job_id,user_id,key_id,encrypted_key,provider,protocol,base_url,model,temperature,max_tokens)
 values(v_id,p_user_id,p_key_id,p_encrypted_key,p_provider,p_protocol,p_base_url,p_model,p_temperature,p_max_tokens);
 return v_id;
end;
$$;
revoke all on function public.claudia_enqueue_byok(uuid,text,text,text,bigint,text,jsonb,text,text,text,text,text,text,numeric,integer) from public,anon,authenticated;
grant execute on function public.claudia_enqueue_byok(uuid,text,text,text,bigint,text,jsonb,text,text,text,text,text,text,numeric,integer) to service_role;
commit;
