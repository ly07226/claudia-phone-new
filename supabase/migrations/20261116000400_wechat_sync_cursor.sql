-- Commit-ordered cursor for lossless insertion pagination.
-- A transactional counter row is locked until commit, unlike a PostgreSQL
-- sequence (which can allocate N+1 before N commits and cause missed rows).
create table if not exists public.claudia_wechat_sync_counter (
 singleton boolean primary key default true check(singleton),
 last_value bigint not null default 0 check(last_value>=0)
);
revoke all on public.claudia_wechat_sync_counter from public,anon,authenticated;
alter table public.claudia_wechat_sync_counter enable row level security;

-- Block writers during backfill to prevent a concurrent insert escaping cursor assignment.
lock table public.claudia_wechat_messages in access exclusive mode;
alter table public.claudia_wechat_messages add column if not exists sync_seq bigint;
with ordered as (
 select id,row_number() over(order by received_at,id) as n
 from public.claudia_wechat_messages
 where sync_seq is null
), existing as (
 select coalesce(max(sync_seq),0) as n from public.claudia_wechat_messages
)
update public.claudia_wechat_messages m
set sync_seq=existing.n+ordered.n
from ordered,existing where m.id=ordered.id;
insert into public.claudia_wechat_sync_counter(singleton,last_value)
values(true,(select coalesce(max(sync_seq),0) from public.claudia_wechat_messages))
on conflict(singleton) do update set last_value=greatest(
 public.claudia_wechat_sync_counter.last_value,excluded.last_value
);
alter table public.claudia_wechat_messages alter column sync_seq set not null;
create unique index if not exists claudia_wechat_sync_seq_unique
 on public.claudia_wechat_messages(sync_seq);
create index if not exists claudia_wechat_sync_cursor
 on public.claudia_wechat_messages(user_id,binding_id,sync_seq);

create or replace function public.claudia_wechat_assign_sync_seq()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_next bigint;
begin
 update public.claudia_wechat_sync_counter
 set last_value=last_value+1 where singleton=true
 returning last_value into v_next;
 if v_next is null then raise exception 'sync counter not initialized'; end if;
 new.sync_seq=v_next;
 return new;
end; $$;
revoke all on function public.claudia_wechat_assign_sync_seq() from public,anon,authenticated;
drop trigger if exists claudia_wechat_sync_seq_insert on public.claudia_wechat_messages;
create trigger claudia_wechat_sync_seq_insert before insert on public.claudia_wechat_messages
for each row execute function public.claudia_wechat_assign_sync_seq();

-- Do not allow service callers to mutate a message's immutable cursor.
create or replace function public.claudia_wechat_reject_sync_seq_update()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.sync_seq is distinct from old.sync_seq then
 raise exception 'sync sequence is immutable' using errcode='23514';
 end if;
 return new;
end; $$;
drop trigger if exists claudia_wechat_sync_seq_immutable on public.claudia_wechat_messages;
create trigger claudia_wechat_sync_seq_immutable before update of sync_seq
on public.claudia_wechat_messages for each row
execute function public.claudia_wechat_reject_sync_seq_update();
