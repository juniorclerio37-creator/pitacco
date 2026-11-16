create table pitacco_private.ifood_merchants (
  merchant_id uuid primary key,
  store_id uuid not null references public.stores(id),
  test_only boolean not null,
  enabled boolean not null default false,
  credential text
);
create index pitacco_ifood_merchants_by_store on pitacco_private.ifood_merchants(store_id);

create table pitacco_private.ifood_events (
  id uuid primary key,
  merchant_id uuid not null references pitacco_private.ifood_merchants(merchant_id),
  order_id uuid not null,
  code text not null check(code in ('PLACED','CONFIRMED','READY_TO_PICKUP','DISPATCHED','CANCELLED','CONCLUDED')),
  event_at timestamptz not null,
  run_at timestamptz not null default now(),
  lease uuid,
  attempts integer not null default 0,
  done_at timestamptz
);
create index pitacco_ifood_events_due on pitacco_private.ifood_events(run_at) where done_at is null;

create table pitacco_private.ifood_order_links (
  external_id uuid primary key,
  order_id uuid not null unique references public.orders(id),
  merchant_id uuid not null references pitacco_private.ifood_merchants(merchant_id),
  state_rank integer not null,
  event_at timestamptz not null
);

revoke all on pitacco_private.ifood_merchants, pitacco_private.ifood_events, pitacco_private.ifood_order_links
from public,anon,authenticated;

create function public.pitacco_ifood_connections(p_store uuid)
returns table(merchant_id uuid,test_only boolean,enabled boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_store_manager(p_store) then
    raise exception 'Sem permissão para consultar o iFood desta loja' using errcode='42501';
  end if;
  return query select m.merchant_id,m.test_only,m.enabled
    from pitacco_private.ifood_merchants m where m.store_id=p_store order by m.merchant_id;
end $$;

create function public.pitacco_owner_save_ifood(p_store uuid,p_merchant uuid,p_test boolean,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare current_binding pitacco_private.ifood_merchants%rowtype;
begin
  if not public.pitacco_is_platform_owner() then raise exception 'Somente o proprietário pode vincular o iFood' using errcode='42501'; end if;
  if p_store is null or p_merchant is null or p_test is null or p_enabled is null then
    raise exception 'Dados de vínculo incompletos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ifood:'||p_merchant::text,0));
  perform 1 from public.stores where id=p_store for update;
  if not found then raise exception 'Loja indisponível'; end if;
  select * into current_binding from pitacco_private.ifood_merchants where merchant_id=p_merchant;
  if found then
    if current_binding.store_id<>p_store then raise exception 'Esta conta iFood já está vinculada a outro estabelecimento'; end if;
    if current_binding.test_only<>p_test and exists (
      select 1 from pitacco_private.ifood_events where merchant_id=p_merchant
    ) then raise exception 'Use um identificador de conta distinto para produção e homologação'; end if;
    update pitacco_private.ifood_merchants set enabled=p_enabled,test_only=p_test where merchant_id=p_merchant;
  else
    if (select count(*) from pitacco_private.ifood_merchants where store_id=p_store)>=3 then
      raise exception 'Limite de três contas iFood por estabelecimento';
    end if;
    insert into pitacco_private.ifood_merchants(merchant_id,store_id,enabled,test_only) values(p_merchant,p_store,p_enabled,p_test);
  end if;
  insert into public.operation_audit(store_id,actor,action,details)
  values(p_store,auth.uid(),'ifood_binding_saved',jsonb_build_object('merchant_id',p_merchant,'enabled',p_enabled,'test_only',p_test));
end $$;

revoke all on function public.pitacco_ifood_connections(uuid),public.pitacco_owner_save_ifood(uuid,uuid,boolean,boolean)
from public,anon,authenticated;
grant execute on function public.pitacco_ifood_connections(uuid),public.pitacco_owner_save_ifood(uuid,uuid,boolean,boolean)
to authenticated;

create function public.pitacco_ifood_online(p_merchants uuid[])
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(merchant_id),array[]::uuid[]) from pitacco_private.ifood_merchants
  where enabled and credential is null and merchant_id=any(p_merchants) and cardinality(p_merchants)<=1000
$$;

create function public.pitacco_ifood_enqueue(p_id uuid,p_merchant uuid,p_order uuid,p_code text,p_at timestamptz,p_distributed boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  insert into pitacco_private.ifood_events(id,merchant_id,order_id,code,event_at)
  select p_id,merchant_id,p_order,p_code,p_at from pitacco_private.ifood_merchants
    where merchant_id=p_merchant and enabled and (credential is not null)=p_distributed
  on conflict(id) do nothing;
  return found;
end $$;

create function public.pitacco_ifood_claim(p_event uuid default null)
returns table(event_id uuid,merchant_id uuid,external_order_id uuid,lease uuid)
language sql security definer set search_path='' as $$
  with next_events as (
    select e.id from pitacco_private.ifood_events e join pitacco_private.ifood_merchants m using(merchant_id)
    where e.done_at is null and e.run_at<=now() and e.attempts<10 and m.enabled and (p_event is null or e.id=p_event)
    order by e.run_at,e.event_at,e.id limit 12 for update of e skip locked
  )
  update pitacco_private.ifood_events e set lease=gen_random_uuid(),run_at=now()+interval '90 seconds',attempts=attempts+1
  from next_events where e.id=next_events.id returning e.id,e.merchant_id,e.order_id,e.lease
$$;

create function public.pitacco_ifood_complete(p_event uuid,p_lease uuid,p_order jsonb,p_test boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  e pitacco_private.ifood_events%rowtype;
  m pitacco_private.ifood_merchants%rowtype;
  link pitacco_private.ifood_order_links%rowtype;
  order_id uuid;
  next_rank integer;
  next_status text;
  next_preparation text;
begin
  select * into e from pitacco_private.ifood_events where id=p_event and lease=p_lease and done_at is null for update;
  if not found then return; end if;
  if p_order is null then
    update pitacco_private.ifood_events set lease=null,
      run_at=now()+make_interval(secs=>least(900,10 * (2 ^ least(e.attempts,6)))::double precision)
    where id=e.id;
    return;
  end if;
  select * into m from pitacco_private.ifood_merchants where merchant_id=e.merchant_id and enabled for share;
  if not found then return; end if;
  if (p_order->>'external_order_id')::uuid is distinct from e.order_id
     or (p_order->>'merchant_id')::uuid is distinct from e.merchant_id or p_test is null then
    raise exception 'Evento iFood incompatível com o pedido';
  end if;
  if m.test_only is distinct from p_test then
    update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ifood-order:'||e.order_id::text,0));
  select * into link from pitacco_private.ifood_order_links where external_id=e.order_id;
  if found and link.merchant_id<>e.merchant_id then raise exception 'Pedido iFood pertence a outra conta'; end if;
  next_rank:=case e.code when 'PLACED' then 1 when 'CONFIRMED' then 2 when 'READY_TO_PICKUP' then 3
    when 'DISPATCHED' then 4 when 'CONCLUDED' then 5 when 'CANCELLED' then 6 end;
  next_status:=case e.code when 'PLACED' then 'pending' when 'CANCELLED' then 'cancelled' else 'accepted' end;
  next_preparation:=case e.code when 'CONCLUDED' then 'completed' when 'READY_TO_PICKUP' then 'ready'
    when 'DISPATCHED' then 'ready' else 'preparing' end;
  if link.external_id is null then
    insert into public.orders(store_id,channel,source,status,preparation_status,gross,created_at,receipt,accepted_at)
    values(m.store_id,'iFood','ifood',next_status,next_preparation,(p_order->>'total')::numeric,
      (p_order->>'created_at')::timestamptz,
      (p_order-'merchant_id'-'created_at')||jsonb_build_object('ifood_status',e.code,'ifood_test',p_test,'ifood_received_at',now()),
      case when next_status='accepted' then e.event_at end)
    returning id into order_id;
    insert into pitacco_private.ifood_order_links values(e.order_id,order_id,e.merchant_id,next_rank,e.event_at);
    insert into public.operation_audit(store_id,order_id,action,details)
    values(m.store_id,order_id,'ifood_order_received',jsonb_build_object('event_id',e.id,'status',e.code));
  elsif (next_rank>link.state_rank and (e.event_at>=link.event_at or e.code='CANCELLED')) then
    update public.orders set status=next_status,preparation_status=next_preparation,
      receipt=receipt||jsonb_build_object('ifood_status',e.code),
      accepted_at=coalesce(accepted_at,case when next_status='accepted' then e.event_at end)
    where id=link.order_id and store_id=m.store_id;
    update pitacco_private.ifood_order_links set state_rank=next_rank,event_at=greatest(event_at,e.event_at)
    where external_id=e.order_id;
  end if;
  update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
end $$;

revoke all on function public.pitacco_ifood_online(uuid[]),public.pitacco_ifood_enqueue(uuid,uuid,uuid,text,timestamptz,boolean),
 public.pitacco_ifood_claim(uuid),public.pitacco_ifood_complete(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_online(uuid[]),public.pitacco_ifood_enqueue(uuid,uuid,uuid,text,timestamptz,boolean),
 public.pitacco_ifood_claim(uuid),public.pitacco_ifood_complete(uuid,uuid,jsonb,boolean) to service_role;

-- The distributed OAuth flow is enabled for merchants after general homologation.
create table pitacco_private.ifood_control (
  singleton boolean primary key default true check(singleton),
  merchant_linking boolean not null default false,
  queue_key uuid,
  queue_expires_at timestamptz
);
insert into pitacco_private.ifood_control default values;
alter table pitacco_private.ifood_merchants add column poll_after timestamptz not null default now(),
  add column poll_lease uuid,
  add column last_poll_ok timestamptz;
create table pitacco_private.ifood_authorizations (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null references auth.users(id),
  store_id uuid not null references public.stores(id),
  merchant_id uuid not null,
  test_only boolean not null,
  verifier text not null,
  expires_at timestamptz not null,
  unique(actor,store_id)
);
revoke all on pitacco_private.ifood_control,pitacco_private.ifood_authorizations from public,anon,authenticated;

create function public.pitacco_ifood_linking_status()
returns boolean language sql stable security definer set search_path='' as $$
  select merchant_linking from pitacco_private.ifood_control where auth.uid() is not null
$$;
create function public.pitacco_owner_enable_ifood_linking(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.pitacco_is_platform_owner() then raise exception 'Somente o proprietário pode liberar a integração' using errcode='42501'; end if;
  update pitacco_private.ifood_control set merchant_linking=p_enabled;
end $$;
revoke all on function public.pitacco_ifood_linking_status(),public.pitacco_owner_enable_ifood_linking(boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_linking_status(),public.pitacco_owner_enable_ifood_linking(boolean) to authenticated;

create function public.pitacco_ifood_begin_auth(p_actor uuid,p_store uuid,p_merchant uuid,p_test boolean,p_verifier text,p_seconds integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare ref uuid;
begin
  if p_seconds not between 1 and 600 or length(p_verifier) not between 12 and 16000 then raise exception 'Autorização inválida'; end if;
  insert into pitacco_private.ifood_authorizations(actor,store_id,merchant_id,test_only,verifier,expires_at)
  values(p_actor,p_store,p_merchant,p_test,p_verifier,now()+make_interval(secs=>p_seconds))
  on conflict(actor,store_id) do update set id=excluded.id,merchant_id=excluded.merchant_id,
    test_only=excluded.test_only,verifier=excluded.verifier,expires_at=excluded.expires_at
  returning id into ref;
  return ref;
end $$;

create function public.pitacco_ifood_take_auth(p_ref uuid,p_actor uuid,p_store uuid)
returns table(merchant_id uuid,test_only boolean,verifier text) language sql security definer set search_path='' as $$
  delete from pitacco_private.ifood_authorizations a where a.id=p_ref and a.actor=p_actor and a.store_id=p_store
    and a.expires_at>now() returning a.merchant_id,a.test_only,a.verifier
$$;

create function public.pitacco_ifood_link_verified(p_store uuid,p_merchant uuid,p_test boolean,p_credential text)
returns void language plpgsql security definer set search_path='' as $$
declare existing pitacco_private.ifood_merchants%rowtype;
begin
  if length(p_credential) not between 12 and 60000 then raise exception 'Credencial inválida'; end if;
  if not p_test and not (select merchant_linking from pitacco_private.ifood_control) then raise exception 'Homologação geral pendente'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ifood:'||p_merchant::text,0));
  perform 1 from public.stores where id=p_store for update;
  if not found then raise exception 'Loja indisponível'; end if;
  select * into existing from pitacco_private.ifood_merchants where merchant_id=p_merchant;
  if found then
    if existing.store_id<>p_store or existing.test_only is distinct from p_test then
      raise exception 'Esta conta iFood já está vinculada a outro estabelecimento ou ambiente';
    end if;
    update pitacco_private.ifood_merchants set credential=p_credential,enabled=true,poll_after=now(),poll_lease=null
      where merchant_id=p_merchant;
  else
    if (select count(*) from pitacco_private.ifood_merchants where store_id=p_store)>=3 then raise exception 'Limite de três contas iFood por estabelecimento'; end if;
    insert into pitacco_private.ifood_merchants(merchant_id,store_id,enabled,test_only,credential)
    values(p_merchant,p_store,true,p_test,p_credential);
  end if;
end $$;

create function public.pitacco_ifood_claim_poll()
returns table(merchant_id uuid,credential text,lease uuid) language sql security definer set search_path='' as $$
  with due as (
    select m.merchant_id from pitacco_private.ifood_merchants m where m.enabled and m.credential is not null
      and m.poll_after<=now() and (m.test_only or (select merchant_linking from pitacco_private.ifood_control))
    order by m.poll_after,m.merchant_id limit 24 for update skip locked
  )
  update pitacco_private.ifood_merchants m set poll_after=now()+interval '90 seconds',poll_lease=gen_random_uuid()
  from due where m.merchant_id=due.merchant_id returning m.merchant_id,m.credential,m.poll_lease
$$;

create function public.pitacco_ifood_save_poll(p_merchant uuid,p_lease uuid,p_credential text,p_ok boolean,p_revoked boolean default false)
returns boolean language sql security definer set search_path='' as $$
  with changed as (
    update pitacco_private.ifood_merchants set poll_after=case when p_ok then greatest(now(),poll_after-interval '60 seconds') else now()+interval '2 minutes' end,
      credential=coalesce(p_credential,credential),
      poll_lease=null,enabled=enabled and not p_revoked,
      last_poll_ok=case when p_ok then now() else last_poll_ok end
    where merchant_id=p_merchant and poll_lease=p_lease returning merchant_id
  ) select exists(select 1 from changed)
$$;

create function public.pitacco_ifood_poll_credential(p_merchant uuid)
returns text language sql stable security definer set search_path='' as $$
  select credential from pitacco_private.ifood_merchants where merchant_id=p_merchant and enabled
$$;
revoke all on function public.pitacco_ifood_begin_auth(uuid,uuid,uuid,boolean,text,integer),
 public.pitacco_ifood_take_auth(uuid,uuid,uuid),public.pitacco_ifood_link_verified(uuid,uuid,boolean,text),
 public.pitacco_ifood_claim_poll(),public.pitacco_ifood_save_poll(uuid,uuid,text,boolean,boolean),public.pitacco_ifood_poll_credential(uuid)
 from public,anon,authenticated;
grant execute on function public.pitacco_ifood_begin_auth(uuid,uuid,uuid,boolean,text,integer),
 public.pitacco_ifood_take_auth(uuid,uuid,uuid),public.pitacco_ifood_link_verified(uuid,uuid,boolean,text),
 public.pitacco_ifood_claim_poll(),public.pitacco_ifood_save_poll(uuid,uuid,text,boolean,boolean),public.pitacco_ifood_poll_credential(uuid)
 to service_role;

create function public.pitacco_ifood_retry_authorized(p_key uuid)
returns boolean language sql security definer set search_path='' as $$
  with consumed as (
    update pitacco_private.ifood_control set queue_key=null,queue_expires_at=null
    where queue_key=p_key and queue_expires_at>now() returning singleton
  ) select exists(select 1 from consumed)
$$;
revoke all on function public.pitacco_ifood_retry_authorized(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_retry_authorized(uuid) to service_role;
