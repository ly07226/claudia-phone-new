-- Additive only: existing contexts, messages, credentials and bindings remain intact.
-- Deploy BEFORE the v2 Edge functions/frontend. No production migration is run by this PR.
alter table public.claudia_qq_context_snapshots add column if not exists context_data jsonb;
-- Older checked-in QQ installations predate the runtime lease/fragment columns.
alter table public.claudia_qq_messages
 add column if not exists part_index integer,
 add column if not exists in_reply_to uuid,
 add column if not exists route_type text,
 add column if not exists route_target text,
 add column if not exists reply_body text,
 add column if not exists lease_until timestamptz,
 add column if not exists attempt_count integer not null default 0,
 add column if not exists last_error text;
create or replace function public.claudia_qq_commit_context(p_binding_id uuid,p_user_id uuid,p_expected_revision uuid,p_revision uuid,p_messages jsonb,p_data jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_revision uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 -- Serialize even the first insert, and verify the service-role caller's explicit tenant.
 perform 1 from public.claudia_qq_bindings where id=p_binding_id and user_id=p_user_id and status='connected' for update;
 if not found then raise exception 'binding_not_owned'; end if;
 select revision into current_revision from public.claudia_qq_context_snapshots where binding_id=p_binding_id and user_id=p_user_id;
 if current_revision is distinct from p_expected_revision then return false; end if;
 if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages) not between 1 and 64 or length(p_messages::text)>100000 then raise exception 'invalid_context'; end if;
 if p_data is not null and (jsonb_typeof(p_data)<>'object' or length(p_data::text)>2200000 or p_data->>'characterId' is distinct from (select character_id from public.claudia_qq_bindings where id=p_binding_id)) then raise exception 'invalid_context_data'; end if;
 insert into public.claudia_qq_context_snapshots(binding_id,user_id,revision,context_messages,context_data,updated_at)
 values(p_binding_id,p_user_id,p_revision,p_messages,p_data,now())
 on conflict(binding_id) do update set revision=excluded.revision,context_messages=excluded.context_messages,context_data=excluded.context_data,updated_at=excluded.updated_at;
 return true;
end $$;
revoke all on function public.claudia_qq_commit_context(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claudia_qq_commit_context(uuid,uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- Per-owner/binding history, read fresh on every generation. No model or summary calls.
-- Scope index bounds candidate ownership; recent window is ordered, recall uses a bounded result.
create or replace function public.claudia_qq_history_context(p_user_id uuid,p_binding_id uuid,p_before timestamptz,p_before_id uuid,p_terms text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare recent jsonb; recalled jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.claudia_qq_bindings where id=p_binding_id and user_id=p_user_id and status='connected') then raise exception 'binding_not_owned'; end if;
 if coalesce(cardinality(p_terms),0)>48 or exists(select 1 from unnest(p_terms) t where length(t)>100) then raise exception 'invalid_terms'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at,x.part_index nulls first,x.id),'[]'::jsonb) into recent from (
  select id,direction,body,status,received_at,part_index,in_reply_to from public.claudia_qq_messages
  where user_id=p_user_id and binding_id=p_binding_id and (received_at,id)<(p_before,p_before_id)
   and ((direction='inbound') or (direction='outbound' and status='sent'))
  order by received_at desc,part_index desc nulls last,id desc limit 30
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at,x.id),'[]'::jsonb) into recalled from (
  select m.id,m.direction,m.body,m.status,m.received_at,m.in_reply_to from public.claudia_qq_messages m
  where m.user_id=p_user_id and m.binding_id=p_binding_id and (m.received_at,m.id)<(p_before,p_before_id)
   and ((m.direction='inbound') or (m.direction='outbound' and m.status='sent'))
   and not exists(select 1 from jsonb_array_elements(recent) r where r->>'id'=m.id::text)
   and exists(select 1 from unnest(p_terms) t where length(t)>=2 and strpos(lower(m.body),t)>0)
  order by (select count(*) from unnest(p_terms) t where strpos(lower(m.body),t)>0) desc,m.received_at desc,m.id desc limit 8
 ) x;
 return jsonb_build_object('recent',recent,'recalled',recalled);
end $$;
revoke all on function public.claudia_qq_history_context(uuid,uuid,timestamptz,uuid,text[]) from public,anon,authenticated;
grant execute on function public.claudia_qq_history_context(uuid,uuid,timestamptz,uuid,text[]) to service_role;

-- Preserve bubble order at identical transaction timestamps. Existing {at,id}
-- cursors remain valid: recover their part_index from the owner-scoped source row.
create index if not exists claudia_qq_sync_order_idx on public.claudia_qq_messages(user_id,binding_id,received_at,(coalesce(part_index,0)),id);
create or replace view public.claudia_qq_sync_records with (security_invoker=true) as
select m.id,m.user_id,m.binding_id,m.external_message_id,m.direction,m.body,
   case when parent.reply_body is not null and g.pending then 'generated' else m.status end as status,
   m.local_message_id,m.received_at,m.part_index,m.in_reply_to,parent.reply_body,g.ready as reply_ready,g.ids as reply_part_ids
  from public.claudia_qq_messages m
  left join public.claudia_qq_messages parent on parent.id=m.in_reply_to and parent.user_id=m.user_id and parent.binding_id=m.binding_id
  left join lateral (
   select bool_and(p.status='sent') as ready,bool_or(p.status not in ('sent','failed')) as pending,
    array_agg(p.id order by coalesce(p.part_index,0),p.id) as ids
   from public.claudia_qq_messages p where m.in_reply_to is not null and p.user_id=m.user_id and p.binding_id=m.binding_id and p.in_reply_to=m.in_reply_to and p.direction='outbound'
  ) g on true;
revoke all on public.claudia_qq_sync_records from public,anon,authenticated;
grant select on public.claudia_qq_sync_records to service_role;
create or replace function public.claudia_qq_sync_page(p_user_id uuid,p_binding_id uuid,p_after jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare at_time timestamptz; at_id uuid; at_part integer:=0; rows jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.claudia_qq_bindings where id=p_binding_id and user_id=p_user_id and status='connected') then raise exception 'binding_not_owned'; end if;
 if p_after is not null then
  at_time:=(p_after->>'at')::timestamptz; at_id:=(p_after->>'id')::uuid;
  select coalesce(part_index,0) into at_part from public.claudia_qq_messages where user_id=p_user_id and binding_id=p_binding_id and id=at_id and received_at=at_time;
  -- A missing source cursor must not silently skip a restored/repaired history.
  if not found then raise exception 'sync_cursor_missing'; end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at,coalesce(x.part_index,0),x.id),'[]'::jsonb) into rows from (
  select m.id,m.external_message_id,m.direction,m.body,m.status,m.local_message_id,m.received_at,m.part_index,m.in_reply_to,m.reply_body,m.reply_ready,m.reply_part_ids
  from public.claudia_qq_sync_records m
  where m.user_id=p_user_id and m.binding_id=p_binding_id
   and (p_after is null or (m.received_at,coalesce(m.part_index,0),m.id)>(at_time,at_part,at_id))
  order by m.received_at,coalesce(m.part_index,0),m.id limit 101
 ) x;
 return rows;
end $$;
revoke all on function public.claudia_qq_sync_page(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claudia_qq_sync_page(uuid,uuid,jsonb) to service_role;

-- One in-flight paid generation per binding. A lost response is an uncertain
-- paid outcome, not permission to silently charge the same inbound again.
create or replace function public.claudia_qq_claim_inbound(p_binding_id uuid,p_lease_seconds integer default 240)
returns setof public.claudia_qq_messages language plpgsql security definer set search_path='' as $$
declare v public.claudia_qq_messages%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 perform 1 from public.claudia_qq_bindings where id=p_binding_id and status='connected' for update skip locked;
 if not found then return; end if;
 if exists(select 1 from public.claudia_qq_messages where binding_id=p_binding_id and direction='inbound' and status='processing' and lease_until>=now()) then return; end if;
 update public.claudia_qq_messages set status='failed',last_error='generation_interrupted_check_before_retry',lease_until=null
 where binding_id=p_binding_id and direction='inbound' and status='processing' and (lease_until is null or lease_until<now());
 select m.* into v from public.claudia_qq_messages m
 join public.claudia_qq_bindings b on b.id=m.binding_id and b.user_id=m.user_id and b.status='connected'
 join public.claudia_qq_ai_profiles p on p.binding_id=m.binding_id and p.user_id=m.user_id and p.enabled=true
 join public.claudia_qq_context_snapshots c on c.binding_id=m.binding_id and c.user_id=m.user_id
 where m.binding_id=p_binding_id and m.direction='inbound' and m.status='received'
 order by m.received_at,m.id for update of m skip locked limit 1;
 if not found then return; end if;
 update public.claudia_qq_messages set status='processing',lease_until=now()+make_interval(secs=>greatest(30,least(p_lease_seconds,600))),attempt_count=attempt_count+1 where id=v.id returning * into v;
 return next v;
end $$;
revoke all on function public.claudia_qq_claim_inbound(uuid,integer) from public,anon,authenticated;
grant execute on function public.claudia_qq_claim_inbound(uuid,integer) to service_role;


-- Preserve the original generated reply once on its inbound task. Outbound
-- fragments retain their existing IDs, text, routing, status and send behavior.
create index if not exists claudia_qq_reply_parts_idx on public.claudia_qq_messages(user_id,binding_id,in_reply_to,part_index);
create or replace function public.claudia_qq_finish_generation(p_inbound_id uuid,p_expected_lease_until timestamptz,p_reply_body text,p_error_code text,p_parts jsonb default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v public.claudia_qq_messages%rowtype; piece text; i integer; n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 select m.* into v from public.claudia_qq_messages m join public.claudia_qq_bindings b on b.id=m.binding_id and b.user_id=m.user_id
 where m.id=p_inbound_id and m.direction='inbound' and m.status='processing' and m.lease_until=p_expected_lease_until for update of m;
 if not found then return false; end if;
 if p_reply_body is not null and length(trim(p_reply_body)) between 1 and 8000
  and exists(select 1 from public.claudia_qq_ai_profiles where binding_id=v.binding_id and user_id=v.user_id and enabled=true)
  and exists(select 1 from public.claudia_qq_context_snapshots where binding_id=v.binding_id and user_id=v.user_id) then
  if p_parts is null then p_parts:=jsonb_build_array(trim(p_reply_body)); end if;
  if jsonb_typeof(p_parts)<>'array' then raise exception 'invalid_parts'; end if;
  n:=jsonb_array_length(p_parts);if n<1 or n>32 then raise exception 'invalid_parts_count'; end if;
  if exists(select 1 from jsonb_array_elements(p_parts) value where jsonb_typeof(value)<>'string') then raise exception 'invalid_parts'; end if;
  if (select string_agg(regexp_replace(value #>> '{}','[[:space:]]','','g'),'' order by ord) from jsonb_array_elements(p_parts) with ordinality as x(value,ord))<>regexp_replace(trim(p_reply_body),'[[:space:]]','','g') then raise exception 'parts_not_lossless'; end if;
  for i in 1..n loop
   piece:=p_parts->>(i-1);if length(trim(piece))<1 or length(piece)>1200 then raise exception 'invalid_part_length'; end if;
   insert into public.claudia_qq_messages(user_id,binding_id,external_message_id,direction,body,status,route_type,route_target,in_reply_to,part_index)
   values(v.user_id,v.binding_id,'reply:'||v.id||':'||lpad(i::text,3,'0'),'outbound',piece,'generated',v.route_type,v.route_target,v.id,i)
   on conflict(binding_id,external_message_id,direction) do nothing;
  end loop;
  update public.claudia_qq_messages set status='generated',lease_until=null,last_error=null,reply_body=trim(p_reply_body) where id=v.id;
 else
  update public.claudia_qq_messages set status='failed',lease_until=null,last_error=left(coalesce(p_error_code,'generation_failed'),100) where id=v.id;
 end if;
 return true;
end $$;
revoke all on function public.claudia_qq_finish_generation(uuid,timestamptz,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claudia_qq_finish_generation(uuid,timestamptz,text,text,jsonb) to service_role;


-- Pending deliveries are watched independently. They do not block newer
-- acknowledged messages; the cursor and pending IDs are committed together locally.
create or replace function public.claudia_qq_sync_state(p_user_id uuid,p_binding_id uuid,p_after jsonb,p_pending_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare at_time timestamptz; at_id uuid; at_part integer:=0; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if not exists(select 1 from public.claudia_qq_bindings where id=p_binding_id and user_id=p_user_id and status='connected') then raise exception 'binding_not_owned'; end if;
 if coalesce(cardinality(p_pending_ids),0)>1000 then raise exception 'pending_capacity'; end if;
 if p_after is not null then
  at_time:=(p_after->>'at')::timestamptz;at_id:=(p_after->>'id')::uuid;
  select coalesce(part_index,0) into at_part from public.claudia_qq_messages where user_id=p_user_id and binding_id=p_binding_id and id=at_id and received_at=at_time;
  if not found then raise exception 'sync_cursor_missing'; end if;
 end if;
 select jsonb_build_object('scanned',(
  select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at,coalesce(x.part_index,0),x.id),'[]'::jsonb) from (
   select m.id,m.external_message_id,m.direction,m.body,m.status,m.local_message_id,m.received_at,m.part_index,m.in_reply_to,m.reply_body,m.reply_ready,m.reply_part_ids
   from public.claudia_qq_sync_records m where m.user_id=p_user_id and m.binding_id=p_binding_id
    and (p_after is null or (m.received_at,coalesce(m.part_index,0),m.id)>(at_time,at_part,at_id))
   order by m.received_at,coalesce(m.part_index,0),m.id limit 101
  ) x
 ),'pending',(
  select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at,coalesce(x.part_index,0),x.id),'[]'::jsonb) from (
   select m.id,m.external_message_id,m.direction,m.body,m.status,m.local_message_id,m.received_at,m.part_index,m.in_reply_to,m.reply_body,m.reply_ready,m.reply_part_ids
   from public.claudia_qq_sync_records m where m.user_id=p_user_id and m.binding_id=p_binding_id and m.id=any(coalesce(p_pending_ids,'{}'::uuid[]))
  ) x
 )) into result;
 return result;
end $$;
revoke all on function public.claudia_qq_sync_state(uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.claudia_qq_sync_state(uuid,uuid,jsonb,uuid[]) to service_role;
