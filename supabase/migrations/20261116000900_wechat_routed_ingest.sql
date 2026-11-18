-- Atomically insert verified inbound text and encrypted reply route.
-- The trusted worker must validate iLink event authenticity before invoking ingest.
create or replace function public.claudia_wechat_receive_routed_text(
 p_user_id uuid,p_binding_id uuid,p_external_message_id text,p_body text,
 p_peer_ciphertext text,p_context_ciphertext text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if p_peer_ciphertext is null or length(p_peer_ciphertext) not between 10 and 4096
 or p_context_ciphertext is null or length(p_context_ciphertext) not between 10 and 4096
 then raise exception 'missing reply route' using errcode='22023'; end if;
 if not exists(select 1 from public.claudia_wechat_bindings b
  where b.id=p_binding_id and b.user_id=p_user_id and b.status='connected')
 then raise exception 'invalid binding' using errcode='23514'; end if;
 insert into public.claudia_wechat_messages(
  user_id,binding_id,external_message_id,direction,body,status,
  ilink_peer_ciphertext,ilink_context_ciphertext
 ) values(p_user_id,p_binding_id,p_external_message_id,'inbound',p_body,'received',
  p_peer_ciphertext,p_context_ciphertext)
 on conflict(binding_id,direction,external_message_id) do nothing returning id into v_id;
 if v_id is null then
  select id into v_id from public.claudia_wechat_messages
  where binding_id=p_binding_id and user_id=p_user_id
  and direction='inbound' and external_message_id=p_external_message_id;
 end if;
 if v_id is null then raise exception 'message conflict' using errcode='23505'; end if;
 return v_id;
end; $$;
revoke all on function public.claudia_wechat_receive_routed_text(uuid,uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.claudia_wechat_receive_routed_text(uuid,uuid,text,text,text,text)
 to service_role;
