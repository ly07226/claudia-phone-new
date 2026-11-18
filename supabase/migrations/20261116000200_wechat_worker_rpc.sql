-- Server-only, atomic WeChat inbound intake and worker leasing.
alter table public.claudia_wechat_messages add column if not exists worker_id uuid;
-- Requires 20261116000100_wechat_daily_bridge.sql.
-- All functions are SECURITY INVOKER; only service_role receives EXECUTE.
-- Never expose service_role credentials to a browser.

create or replace function public.claudia_wechat_receive_text(
 p_user_id uuid, p_binding_id uuid, p_external_message_id text, p_body text,
 p_received_at timestamptz default now()
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
 if p_external_message_id is null or length(p_external_message_id) not between 1 and 256
    or p_body is null or char_length(p_body) not between 1 and 8000
    or p_received_at is null then
   raise exception 'invalid wechat event' using errcode='22023';
 end if;
 -- Never allow a caller to assign a message to a different user or inactive binding.
 if not exists (
   select 1 from public.claudia_wechat_bindings b
   where b.id=p_binding_id and b.user_id=p_user_id and b.status='connected'
 ) then raise exception 'binding not connected or owner mismatch' using errcode='23514'; end if;
 insert into public.claudia_wechat_messages
   (user_id,binding_id,external_message_id,direction,body,status,received_at)
 values (p_user_id,p_binding_id,p_external_message_id,'inbound',p_body,'received',p_received_at)
 on conflict (binding_id,direction,external_message_id) do nothing
 returning id into v_id;
 if v_id is null then
   select m.id into v_id from public.claudia_wechat_messages m
   where m.binding_id=p_binding_id and m.direction='inbound'
     and m.external_message_id=p_external_message_id and m.user_id=p_user_id;
   if v_id is null then raise exception 'message id conflict' using errcode='23505'; end if;
 end if;
 return v_id;
end; $$;

-- Single claimant wins even with multiple workers. No retry of uncertain model calls:
-- expired processing leases are quarantined as unknown by the maintenance function.
create or replace function public.claudia_wechat_claim_inbound(
 p_worker_id uuid, p_lease_seconds integer default 120
) returns table (
 id uuid, user_id uuid, binding_id uuid, external_message_id text,
 body text, attempts integer, lease_until timestamptz
) language plpgsql security invoker set search_path = '' as $$
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 300
 then raise exception 'invalid lease' using errcode='22023'; end if;
 return query
 with candidate as (
   select m.id from public.claudia_wechat_messages m
   join public.claudia_wechat_bindings b on b.id=m.binding_id and b.user_id=m.user_id
   where m.direction='inbound' and m.status='received' and b.status='connected'
   order by m.received_at,m.id
   for update of m skip locked limit 1
 ), claimed as (
   update public.claudia_wechat_messages m
   set status='processing', attempts=m.attempts+1,
       worker_id=p_worker_id, lease_until=now()+make_interval(secs=>p_lease_seconds),
       updated_at=now()
   from candidate c where m.id=c.id
   returning m.id,m.user_id,m.binding_id,m.external_message_id,m.body,m.attempts,m.lease_until
 )
 select c.id,c.user_id,c.binding_id,c.external_message_id,c.body,c.attempts,c.lease_until from claimed c;
end; $$;

-- A worker can finish only while holding a live lease. No late overwrite.
-- This marks the inbound event generated; the outbound message and actual
-- WeChat send receipt require a separate transactional outbox implementation.
create or replace function public.claudia_wechat_complete_inbound(
 p_message_id uuid, p_worker_id uuid, p_expected_lease_until timestamptz, p_success boolean,
 p_error_code text default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_updated integer;
begin
 if p_message_id is null or p_worker_id is null or p_expected_lease_until is null or p_success is null
    or (p_error_code is not null and length(p_error_code)>100)
 then raise exception 'invalid completion' using errcode='22023'; end if;
 update public.claudia_wechat_messages m
 set status=case when p_success then 'generated' else 'failed' end,
     error_code=case when p_success then null else coalesce(p_error_code,'generation_failed') end,
     lease_until=null, worker_id=null, updated_at=now()
 where m.id=p_message_id and m.worker_id=p_worker_id and m.direction='inbound' and m.status='processing'
   and m.lease_until=p_expected_lease_until and m.lease_until>now();
 get diagnostics v_updated=row_count;
 return v_updated=1;
end; $$;

create or replace function public.claudia_wechat_quarantine_expired()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_updated integer;
begin
 update public.claudia_wechat_messages m
 set status='unknown', error_code='lease_expired_requires_reconciliation',
     lease_until=null,worker_id=null,updated_at=now()
 where m.direction='inbound' and m.status='processing' and m.lease_until<now();
 get diagnostics v_updated=row_count;
 return v_updated;
end; $$;

revoke all on function public.claudia_wechat_receive_text(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.claudia_wechat_claim_inbound(uuid,integer) from public,anon,authenticated;
revoke all on function public.claudia_wechat_complete_inbound(uuid,uuid,timestamptz,boolean,text) from public,anon,authenticated;
revoke all on function public.claudia_wechat_quarantine_expired() from public,anon,authenticated;
grant execute on function public.claudia_wechat_receive_text(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.claudia_wechat_claim_inbound(uuid,integer) to service_role;
grant execute on function public.claudia_wechat_complete_inbound(uuid,uuid,timestamptz,boolean,text) to service_role;
grant execute on function public.claudia_wechat_quarantine_expired() to service_role;
