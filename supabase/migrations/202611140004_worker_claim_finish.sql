-- Atomic, server-only worker lease and terminal-state transitions.
-- Do not schedule claims until an actual executor with a secure context source exists.
begin;
create or replace function public.claudia_claim_background_job(p_lease_seconds integer default 90)
returns setof public.claudia_background_jobs
language plpgsql security definer set search_path = ''
as $$
begin
 if auth.role() is distinct from 'service_role' then
   raise exception 'service_role_required' using errcode='42501';
 end if;
 if p_lease_seconds < 15 or p_lease_seconds > 300 then
   raise exception 'invalid_lease';
 end if;
 return query
 with candidate as (
  select j.id from public.claudia_background_jobs j
  where j.status='queued' and j.next_attempt_at<=now()
  order by j.created_at,j.id
  for update skip locked limit 1
 )
 update public.claudia_background_jobs j
 set status='running',attempt_count=j.attempt_count+1,
     leased_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
 from candidate where j.id=candidate.id
 returning j.*;
end;
$$;
revoke all on function public.claudia_claim_background_job(integer) from public,anon,authenticated;
grant execute on function public.claudia_claim_background_job(integer) to service_role;

create or replace function public.claudia_finish_background_job(
 p_job_id uuid,p_attempt integer,p_error_code text default null,
 p_message_id text default null,p_body text default null
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare j public.claudia_background_jobs%rowtype;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'service_role_required' using errcode='42501';
 end if;
 if (p_error_code is null) = (p_body is null) then
  raise exception 'exactly_one_outcome_required';
 end if;
 if p_error_code is not null and (length(p_error_code)>80 or p_error_code !~ '^[a-z0-9_]+$') then
  raise exception 'invalid_error_code';
 end if;
 if p_body is not null and (p_message_id is null or p_message_id !~ '^[a-zA-Z0-9:_-]{1,128}$' or length(p_body) not between 1 and 200000) then
  raise exception 'invalid_reply';
 end if;
 select * into j from public.claudia_background_jobs
 where id=p_job_id for update;
 if not found or j.status<>'running' or j.attempt_count<>p_attempt then
  return false;
 end if;
 if p_body is not null then
  insert into public.claudia_background_replies(user_id,job_id,conversation_id,message_id,body)
  values(j.user_id,j.id,j.conversation_id,p_message_id,p_body);
 end if;
 update public.claudia_background_jobs
 set status=case when p_error_code is null then 'completed' else 'failed' end,
 error_code=p_error_code,leased_until=null,updated_at=now(),
 completed_at=case when p_error_code is null then now() else null end
 where id=p_job_id;
 return true;
end;
$$;
revoke all on function public.claudia_finish_background_job(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.claudia_finish_background_job(uuid,integer,text,text,text) to service_role;
commit;
