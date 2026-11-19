-- Server-side durable retrieval across all cloud WeChat history.
-- Source messages remain the sole authority: no generated fact is stored.
-- Restricted to service_role, with a strict binding and snapshot boundary.
create or replace function public.claudia_wechat_search_history(
 p_binding_id uuid,p_before timestamptz,p_terms text[],p_limit integer default 8
) returns table(id uuid,body text,direction text,status text,received_at timestamptz)
language plpgsql security invoker set search_path='' as $$
begin
 if p_binding_id is null or p_before is null or p_limit not between 1 and 12
 or p_terms is null or cardinality(p_terms) not between 1 and 16
 or exists(select 1 from unnest(p_terms) term
   where length(term) not between 2 and 40)
 then raise exception 'invalid search request' using errcode='22023';end if;
 return query
 select m.id,m.body,m.direction,m.status,m.received_at
 from public.claudia_wechat_messages m
 join public.claudia_wechat_context_snapshots s on s.binding_id=m.binding_id
 join public.claudia_wechat_ai_profiles p on p.binding_id=m.binding_id and p.enabled=true
 join public.claudia_wechat_bindings b on b.id=m.binding_id and b.status='connected'
 where m.binding_id=p_binding_id and m.user_id=b.user_id
 and s.user_id=b.user_id and p.user_id=b.user_id
 and m.received_at>s.history_cutoff and m.received_at<p_before
 and (m.direction='inbound' or (m.direction='outbound' and m.status='sent'))
 and exists(
  select 1 from unnest(p_terms) term
  where strpos(lower(m.body),lower(term))>0
 )
 order by m.received_at desc,m.id desc limit p_limit;
end; $$;
revoke all on function public.claudia_wechat_search_history(uuid,timestamptz,text[],integer)
 from public,anon,authenticated;
grant execute on function public.claudia_wechat_search_history(uuid,timestamptz,text[],integer)
 to service_role;
create index if not exists claudia_wechat_memory_history_idx
 on public.claudia_wechat_messages(binding_id,received_at desc,id desc);
