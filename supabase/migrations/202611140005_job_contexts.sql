-- Optional server-managed AI executor payloads. Never store user provider keys here.
begin;
create table if not exists public.claudia_job_contexts (
 job_id uuid primary key references public.claudia_background_jobs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 messages jsonb not null,
 created_at timestamptz not null default now(),
 constraint claudia_context_array check (jsonb_typeof(messages)='array' and jsonb_array_length(messages) between 1 and 80),
 constraint claudia_context_bytes check (octet_length(messages::text) between 2 and 120000)
);
revoke all on public.claudia_job_contexts from anon,authenticated;
alter table public.claudia_job_contexts enable row level security;
create index if not exists claudia_job_context_owner_idx on public.claudia_job_contexts(user_id);

-- Store the job and its immutable prompt in one transaction.
create or replace function public.claudia_enqueue_with_context(
 p_user_id uuid,p_conversation_id text,p_client_message_id text,
 p_timeline_id text,p_timeline_epoch bigint,p_idempotency_key text,p_messages jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_existing public.claudia_background_jobs%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 if p_messages is null or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages) not between 1 and 80 or octet_length(p_messages::text)>120000 then raise exception 'invalid_context'; end if;
 insert into public.claudia_background_jobs(user_id,conversation_id,client_message_id,timeline_id,timeline_epoch,idempotency_key,kind)
 values(p_user_id,p_conversation_id,p_client_message_id,p_timeline_id,p_timeline_epoch,p_idempotency_key,'reply')
 on conflict(user_id,idempotency_key) do nothing returning id into v_id;
 if v_id is null then
  select * into v_existing from public.claudia_background_jobs where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if not found or v_existing.conversation_id<>p_conversation_id or v_existing.client_message_id<>p_client_message_id or v_existing.timeline_id<>p_timeline_id or v_existing.timeline_epoch<>p_timeline_epoch then raise exception 'idempotency_conflict'; end if;
  return v_existing.id;
 end if;
 insert into public.claudia_job_contexts(job_id,user_id,messages) values(v_id,p_user_id,p_messages);
 return v_id;
end;
$$;
revoke all on function public.claudia_enqueue_with_context(uuid,text,text,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.claudia_enqueue_with_context(uuid,text,text,text,bigint,text,jsonb) to service_role;
commit;
