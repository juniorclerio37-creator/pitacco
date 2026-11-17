create table pitacco_private.courier_push_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into pitacco_private.courier_push_settings default values;
revoke all on pitacco_private.courier_push_settings from public,anon,authenticated;

create table pitacco_private.courier_push_device (
 courier_id uuid primary key references public.couriers(id) on delete cascade,
 session_id uuid not null,
 token text not null unique check(char_length(token) between 32 and 4096),
 expires_at timestamptz not null
);
create table pitacco_private.courier_push_outbox (
 delivery_id uuid primary key references public.deliveries(id) on delete cascade,
 courier_id uuid not null,
 event_id uuid not null unique default gen_random_uuid(),
 expires_at timestamptz not null,
 available_at timestamptz not null default now(),
 attempts integer not null default 0,
 sent_at timestamptz
);
create index courier_push_ready on pitacco_private.courier_push_outbox(available_at) where sent_at is null;
create index courier_push_expiry on pitacco_private.courier_push_outbox(expires_at);
revoke all on pitacco_private.courier_push_device,pitacco_private.courier_push_outbox from public,anon,authenticated;

create function public.pitacco_register_courier_push(p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare v_courier uuid; v_session uuid;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão de entregador inválida' using errcode='42501';
 end if;
 if p_token is null or length(p_token) not between 32 and 4096 or p_token !~ '^[A-Za-z0-9:_-]+$' then
  raise exception 'Dispositivo inválido' using errcode='22023';
 end if;
 select id into strict v_courier from public.couriers where user_id=(select auth.uid()) and active;
 v_session := (select auth.jwt()->>'session_id')::uuid;
 delete from pitacco_private.courier_push_device where token=p_token and courier_id<>v_courier;
 insert into pitacco_private.courier_push_device(courier_id,session_id,token,expires_at)
 values(v_courier,v_session,p_token,now()+interval '30 days')
 on conflict(courier_id) do update set token=excluded.token,session_id=excluded.session_id,expires_at=excluded.expires_at;
end $$;

create function public.pitacco_unregister_courier_push()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from pitacco_private.courier_push_device p using public.couriers c
 where p.courier_id=c.id and c.user_id=(select auth.uid())
   and p.session_id::text=(select auth.jwt()->>'session_id');
end $$;

create function pitacco_private.enqueue_courier_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'atribuida' or new.courier_id is null
    or new.logistics_provider is distinct from 'loja' then return new; end if;
 if tg_op='UPDATE' then
  if old.status=new.status and old.courier_id is not distinct from new.courier_id then return new; end if;
 end if;
 if not exists(select 1 from pitacco_private.courier_push_settings where enabled) then return new; end if;
 if not exists(select 1 from public.couriers c where c.id=new.courier_id and c.store_id=new.store_id and c.active and c.available) then
  return new;
 end if;
 insert into pitacco_private.courier_push_outbox(delivery_id,courier_id,expires_at)
 values(new.id,new.courier_id,now()+interval '3 minutes')
 on conflict(delivery_id) do update set courier_id=excluded.courier_id,event_id=excluded.event_id,
   expires_at=excluded.expires_at,available_at=now(),attempts=0,sent_at=null;
 return new;
end $$;
create trigger pitacco_enqueue_courier_push after insert or update of courier_id,status on public.deliveries
 for each row execute function pitacco_private.enqueue_courier_push();

create function public.pitacco_claim_courier_push()
returns table(event_id uuid,token text)
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from pitacco_private.courier_push_settings where enabled) then return; end if;
 delete from pitacco_private.courier_push_outbox where expires_at<now()-interval '24 hours';
 return query
 with ready as (
  select outbox.delivery_id,device.token
  from pitacco_private.courier_push_outbox outbox
  join public.deliveries d on d.id=outbox.delivery_id and d.courier_id=outbox.courier_id
  join public.couriers c on c.id=d.courier_id and c.store_id=d.store_id and c.active and c.available
  join pitacco_private.courier_push_device device on device.courier_id=c.id and device.expires_at>now()
  join public.pitacco_courier_auth_state auth_state on auth_state.user_id=c.user_id and auth_state.store_id=c.store_id and not auth_state.must_change_password
  join auth.sessions session on session.id=device.session_id and session.user_id=c.user_id and session.created_at>=auth_state.credentials_issued_at
  join auth.users u on u.id=c.user_id and (u.banned_until is null or u.banned_until<=now())
  where outbox.sent_at is null and outbox.expires_at>now() and outbox.available_at<=now() and outbox.attempts<3
    and d.status='atribuida' and d.logistics_provider='loja'
  order by outbox.available_at limit 15 for update of outbox skip locked
 )
 update pitacco_private.courier_push_outbox outbox
 set available_at=now()+interval '25 seconds',attempts=outbox.attempts+1
 from ready where outbox.delivery_id=ready.delivery_id
 returning outbox.event_id,ready.token;
end $$;

create function public.pitacco_finish_courier_push(p_event uuid,p_token text,p_result text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_result='invalid' then
  delete from pitacco_private.courier_push_device where token=p_token;
 end if;
 if p_result in ('sent','invalid','rejected') then
  update pitacco_private.courier_push_outbox set sent_at=now() where event_id=p_event and sent_at is null;
 end if;
end $$;

revoke all on function public.pitacco_register_courier_push(text),public.pitacco_unregister_courier_push(),
 public.pitacco_claim_courier_push(),public.pitacco_finish_courier_push(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_register_courier_push(text),public.pitacco_unregister_courier_push() to authenticated;
grant execute on function public.pitacco_claim_courier_push(),public.pitacco_finish_courier_push(uuid,text,text) to service_role;
