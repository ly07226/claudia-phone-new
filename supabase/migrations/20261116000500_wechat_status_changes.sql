-- Track post-insert delivery state transitions separately from insertion cursor.
-- Commit-ordered global counter avoids missing changes from concurrent transactions.
create table if not exists public.claudia_wechat_change_counter (
 singleton boolean primary key default true check(singleton),
 last_value bigint not null default 0 check(last_value>=0)
);
revoke all on public.claudia_wechat_change_counter from public,anon,authenticated;
alter table public.claudia_wechat_change_counter enable row level security;
lock table public.claudia_wechat_messages in access exclusive mode;
alter table public.claudia_wechat_messages add column if not exists change_seq bigint;
insert into public.claudia_wechat_change_counter(singleton,last_value)
values(true,0) on conflict(singleton) do nothing;
create or replace function public.claudia_wechat_assign_change_seq()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_seq bigint;
begin
 if tg_op='UPDATE' and new.change_seq is distinct from old.change_seq then
  -- Allow one-time backfill only for rows predating this migration.
  if old.change_seq is null and new.change_seq is not null then return new; end if;
  raise exception 'change sequence is immutable' using errcode='23514';
 end if;
 if tg_op='UPDATE' and new.status is not distinct from old.status then
  return new;
 end if;
 update public.claudia_wechat_change_counter set last_value=last_value+1
 where singleton=true returning last_value into v_seq;
 if v_seq is null then raise exception 'change counter missing'; end if;
 new.change_seq=v_seq;
 return new;
end; $$;
revoke all on function public.claudia_wechat_assign_change_seq() from public,anon,authenticated;
drop trigger if exists claudia_wechat_change_seq on public.claudia_wechat_messages;
create trigger claudia_wechat_change_seq before insert or update
on public.claudia_wechat_messages for each row
execute function public.claudia_wechat_assign_change_seq();
-- Backfill legacy rows in a deterministic order while holding exclusive lock.
-- Existing values from prior runs are preserved.
with numbered as (
 select id,row_number() over(order by sync_seq) as n
 from public.claudia_wechat_messages where change_seq is null
), base as (
 select coalesce(max(change_seq),0) as n from public.claudia_wechat_messages
)
update public.claudia_wechat_messages m
set change_seq=base.n+numbered.n from numbered,base where m.id=numbered.id;
update public.claudia_wechat_change_counter set last_value=greatest(
 last_value,(select coalesce(max(change_seq),0) from public.claudia_wechat_messages)
) where singleton=true;
alter table public.claudia_wechat_messages alter column change_seq set not null;
create unique index if not exists claudia_wechat_change_seq_unique
 on public.claudia_wechat_messages(change_seq);
create index if not exists claudia_wechat_change_cursor
 on public.claudia_wechat_messages(user_id,binding_id,change_seq);
