-- Claim only inbound work for a binding with explicitly enabled cloud AI.
-- The global claim API is unsuitable for independent per-user configurations.
create or replace function public.claudia_wechat_claim_inbound_for_binding(
 p_binding_id uuid,p_worker_id uuid,p_lease_seconds integer default 240
) returns table(
 id uuid,user_id uuid,binding_id uuid,external_message_id text,
 body text,attempts integer,lease_until timestamptz
) language plpgsql security invoker set search_path='' as $$
begin
 if p_binding_id is null or p_worker_id is null or p_lease_seconds not between 30 and 300
 then raise exception 'invalid lease' using errcode='22023'; end if;
 return query with candidate as(
  select m.id from public.claudia_wechat_messages m
  join public.claudia_wechat_bindings b on b.id=m.binding_id and b.user_id=m.user_id
  join public.claudia_wechat_ai_profiles p on p.binding_id=b.id
   and p.user_id=b.user_id and p.enabled=true
  where m.binding_id=p_binding_id and m.direction='inbound'
   and m.status='received' and b.status='connected'
  order by m.received_at,m.id for update of m skip locked limit 1
 ),claimed as(
  update public.claudia_wechat_messages m
  set status='processing',worker_id=p_worker_id,attempts=m.attempts+1,
   lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  from candidate c where m.id=c.id
  returning m.id,m.user_id,m.binding_id,m.external_message_id,m.body,m.attempts,m.lease_until
 )
 select c.id,c.user_id,c.binding_id,c.external_message_id,c.body,c.attempts,c.lease_until
 from claimed c;
end; $$;
revoke all on function public.claudia_wechat_claim_inbound_for_binding(uuid,uuid,integer)
 from public,anon,authenticated;
grant execute on function public.claudia_wechat_claim_inbound_for_binding(uuid,uuid,integer)
 to service_role;
