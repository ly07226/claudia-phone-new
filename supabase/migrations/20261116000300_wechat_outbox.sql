-- Transactional outbox for daily WeChat text replies.
-- This migration supersedes the earlier "generated without reply" completion API.
-- A single inbound event can produce at most one outbound row.
alter table public.claudia_wechat_messages
 add column if not exists in_reply_to uuid references public.claudia_wechat_messages(id);
create unique index if not exists claudia_wechat_one_reply_per_inbound
 on public.claudia_wechat_messages(in_reply_to) where in_reply_to is not null;
create index if not exists claudia_wechat_outbox_ready
 on public.claudia_wechat_messages(received_at,id)
 where direction='outbound' and status='generated';

-- Do not permit a model worker to mark "generated" without persisting the reply.
drop function if exists public.claudia_wechat_complete_inbound(uuid,uuid,timestamptz,boolean,text);

create or replace function public.claudia_wechat_finish_generation(
 p_inbound_id uuid, p_worker_id uuid, p_expected_lease_until timestamptz,
 p_reply_body text, p_error_code text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_inbound public.claudia_wechat_messages%rowtype;
declare v_outbound_id uuid;
begin
 if p_inbound_id is null or p_worker_id is null or p_expected_lease_until is null
 or (p_reply_body is not null and char_length(p_reply_body) not between 1 and 8000)
 or (p_error_code is not null and length(p_error_code)>100)
 or (p_reply_body is null and p_error_code is null)
 then raise exception 'invalid generation result' using errcode='22023'; end if;
 select * into v_inbound from public.claudia_wechat_messages m
 where m.id=p_inbound_id and m.direction='inbound' and m.status='processing'
 and m.worker_id=p_worker_id and m.lease_until=p_expected_lease_until
 and m.lease_until>now() for update;
 if not found then raise exception 'generation lease lost' using errcode='40001'; end if;
 if p_reply_body is not null then
   insert into public.claudia_wechat_messages
    (user_id,binding_id,external_message_id,direction,body,status,in_reply_to)
   values (v_inbound.user_id,v_inbound.binding_id,
    'reply:'||v_inbound.id::text,'outbound',p_reply_body,'generated',v_inbound.id)
   returning id into v_outbound_id;
 end if;
 update public.claudia_wechat_messages set
 status=case when p_reply_body is not null then 'generated' else 'failed' end,
 error_code=case when p_reply_body is not null then null else p_error_code end,
 lease_until=null,worker_id=null,updated_at=now()
 where id=p_inbound_id;
 return v_outbound_id;
end; $$;

create or replace function public.claudia_wechat_claim_outbound(
 p_worker_id uuid, p_lease_seconds integer default 120
) returns table(id uuid,user_id uuid,binding_id uuid,body text,attempts integer,lease_until timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 300
 then raise exception 'invalid lease' using errcode='22023'; end if;
 return query with candidate as (
  select m.id from public.claudia_wechat_messages m
  join public.claudia_wechat_bindings b on b.id=m.binding_id and b.user_id=m.user_id
  where m.direction='outbound' and m.status='generated' and b.status='connected'
  order by m.received_at,m.id for update of m skip locked limit 1
 ), claimed as (
  update public.claudia_wechat_messages m
  set status='sending',worker_id=p_worker_id,attempts=m.attempts+1,
  lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  from candidate c where m.id=c.id
  returning m.id,m.user_id,m.binding_id,m.body,m.attempts,m.lease_until
 )
 select c.id,c.user_id,c.binding_id,c.body,c.attempts,c.lease_until from claimed c;
end; $$;

create or replace function public.claudia_wechat_ack_outbound(
 p_outbound_id uuid,p_worker_id uuid,p_expected_lease_until timestamptz,
 p_confirmed_sent boolean,p_error_code text default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
 if p_outbound_id is null or p_worker_id is null or p_expected_lease_until is null
 or p_confirmed_sent is null or (p_error_code is not null and length(p_error_code)>100)
 then raise exception 'invalid receipt' using errcode='22023'; end if;
 update public.claudia_wechat_messages m
 set status=case when p_confirmed_sent then 'sent' else 'unknown' end,
 error_code=case when p_confirmed_sent then null else coalesce(p_error_code,'delivery_unconfirmed') end,
 lease_until=null,worker_id=null,updated_at=now()
 where m.id=p_outbound_id and m.direction='outbound' and m.status='sending'
 and m.worker_id=p_worker_id and m.lease_until=p_expected_lease_until
 and m.lease_until>now();
 get diagnostics v_count=row_count;
 return v_count=1;
end; $$;

-- Expired sending is NOT retried: it may already have reached WeChat.
create or replace function public.claudia_wechat_quarantine_expired()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
 update public.claudia_wechat_messages m
 set status='unknown',error_code='lease_expired_requires_reconciliation',
 lease_until=null,worker_id=null,updated_at=now()
 where m.status in ('processing','sending') and m.lease_until<now();
 get diagnostics v_count=row_count;
 return v_count;
end; $$;

revoke all on function public.claudia_wechat_finish_generation(uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.claudia_wechat_claim_outbound(uuid,integer) from public,anon,authenticated;
revoke all on function public.claudia_wechat_ack_outbound(uuid,uuid,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function public.claudia_wechat_finish_generation(uuid,uuid,timestamptz,text,text) to service_role;
grant execute on function public.claudia_wechat_claim_outbound(uuid,integer) to service_role;
grant execute on function public.claudia_wechat_ack_outbound(uuid,uuid,timestamptz,boolean,text) to service_role;
