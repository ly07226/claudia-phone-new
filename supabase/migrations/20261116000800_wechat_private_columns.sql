-- New encrypted iLink routing fields must never be readable through PostgREST.
-- Replace the earlier table-wide authenticated SELECT with a safe column allowlist.
revoke select on public.claudia_wechat_messages from authenticated;
grant select(
 id,user_id,binding_id,external_message_id,direction,body,status,
 local_message_id,received_at,updated_at,lease_until,attempts,error_code,
 in_reply_to,sync_seq,change_seq,worker_id
) on public.claudia_wechat_messages to authenticated;
-- Credentials and login attempts remain service-role only.
revoke all on public.claudia_wechat_credentials from anon,authenticated;
revoke all on public.claudia_wechat_login_attempts from anon,authenticated;
