-- Reply routing data is private and belongs to the inbound message.
-- Do not accept these fields from a browser or untrusted user endpoint.
alter table public.claudia_wechat_messages
 add column if not exists ilink_peer_ciphertext text,
 add column if not exists ilink_context_ciphertext text;
-- A generated reply refers to its inbound record, so delivery reads routing from
-- the original inbound. No browser grants for these columns.
create index if not exists claudia_wechat_reply_route_idx
 on public.claudia_wechat_messages(in_reply_to)
 where direction='outbound' and in_reply_to is not null;
