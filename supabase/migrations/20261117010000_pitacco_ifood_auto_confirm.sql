
alter table pitacco_private.ifood_order_links
 add column auto_attempts integer not null default 0,
 add column auto_retry_at timestamptz,
 add column auto_lease uuid,
 add column auto_closed boolean not null default false;
create index ifood_auto_confirm_recent on pitacco_private.ifood_order_links(event_at)
 where state_rank=1 and not auto_closed;

create function pitacco_private.ifood_auto_candidates(p_order uuid default null)
returns table(external_id uuid,merchant_id uuid,event_at timestamptz,uses_store_token boolean)
language sql stable set search_path='' as $$
 select l.external_id,l.merchant_id,l.event_at,m.credential is not null
 from pitacco_private.ifood_order_links l
 join pitacco_private.ifood_merchants m using(merchant_id)
 join public.orders o on o.id=l.order_id and o.store_id=m.store_id
 join public.acceptance_settings s on s.store_id=o.store_id and s.source='ifood'
 where l.state_rank=1 and o.status='pending' and o.source='ifood'
  and m.enabled and (m.credential is null or m.test_only or exists(
   select 1 from pitacco_private.ifood_control c where c.merchant_linking))
  and s.enabled and s.mode='automatic'
  and not l.auto_closed and l.auto_attempts<6
  and l.event_at>=now()-interval '7 minutes'
  and (l.auto_retry_at is null or l.auto_retry_at<=now())
  and (p_order is null or l.external_id=p_order);
$$;
revoke all on function pitacco_private.ifood_auto_candidates(uuid) from public,anon,authenticated;

create function public.pitacco_ifood_claim_auto_confirm(p_order uuid default null)
returns table(external_order_id uuid,merchant_id uuid,lease uuid,uses_store_token boolean)
language sql security definer set search_path='' as $$
 with candidates as materialized (
  select c.external_id,c.uses_store_token
  from pitacco_private.ifood_auto_candidates(p_order) c
  join pitacco_private.ifood_order_links l on l.external_id=c.external_id
  where l.state_rank=1 and not l.auto_closed and (l.auto_retry_at is null or l.auto_retry_at<=now())
  order by c.event_at,c.external_id limit 4 for update of l skip locked
 )
 update pitacco_private.ifood_order_links l set auto_attempts=l.auto_attempts+1,
  auto_lease=gen_random_uuid(),auto_retry_at=now()+interval '35 seconds'
 from candidates c where l.external_id=c.external_id
 returning l.external_id,l.merchant_id,l.auto_lease,c.uses_store_token;
$$;

create function public.pitacco_ifood_finish_auto_confirm(p_order uuid,p_lease uuid,p_retry boolean)
returns void language sql security definer set search_path='' as $$
 update pitacco_private.ifood_order_links set auto_lease=null,
  auto_closed=not p_retry
 where external_id=p_order and auto_lease=p_lease and p_retry is not null;
$$;
revoke all on function public.pitacco_ifood_claim_auto_confirm(uuid),public.pitacco_ifood_finish_auto_confirm(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_claim_auto_confirm(uuid),public.pitacco_ifood_finish_auto_confirm(uuid,uuid,boolean) to service_role;

create or replace function public.pitacco_ifood_complete(p_event uuid,p_lease uuid,p_order jsonb,p_test boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  e pitacco_private.ifood_events%rowtype;
  m pitacco_private.ifood_merchants%rowtype;
  link pitacco_private.ifood_order_links%rowtype;
  v_order_id uuid;
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
    returning id into v_order_id;
    insert into pitacco_private.ifood_order_links values(e.order_id,v_order_id,e.merchant_id,next_rank,e.event_at);
    insert into public.operation_audit(store_id,order_id,action,details)
    values(m.store_id,v_order_id,'ifood_order_received',jsonb_build_object('event_id',e.id,'status',e.code));
  elsif (next_rank>link.state_rank and (e.event_at>=link.event_at or e.code='CANCELLED')) then
    v_order_id:=link.order_id;
    update public.orders set status=next_status,preparation_status=next_preparation,
      receipt=receipt||jsonb_build_object('ifood_status',e.code),
      accepted_at=coalesce(accepted_at,case when next_status='accepted' then e.event_at end)
    where id=link.order_id and store_id=m.store_id;
    update pitacco_private.ifood_order_links set state_rank=next_rank,event_at=greatest(event_at,e.event_at)
    where external_id=e.order_id;
  end if;
  if v_order_id is not null and next_status='accepted' and p_order->>'logistics' in ('loja','marketplace') then
    insert into public.deliveries(store_id,order_id,source,logistics_provider,external_order_id,
      customer_name,address,delivery_fee,status,external_delivery_status)
    values(m.store_id,v_order_id,'ifood',p_order->>'logistics',e.order_id::text,
      coalesce(nullif(p_order->>'customer',''),'Cliente iFood'),coalesce(p_order->>'address',''),
      coalesce((p_order->>'delivery_fee')::numeric,0),
      case when e.code='CONCLUDED' then 'entregue' else 'pendente' end,
      case when p_order->>'logistics'='marketplace' then e.code end)
    on conflict do nothing;
  end if;
  if v_order_id is not null and (e.code='CANCELLED' or p_order->>'logistics'='marketplace') then
    update public.deliveries d set external_delivery_status=e.code,
      status=case when e.code='CANCELLED' then 'cancelada' when e.code='CONCLUDED' then 'entregue' else d.status end
    where d.order_id=v_order_id and d.store_id=m.store_id and d.source='ifood'
      and (d.logistics_provider='marketplace' or d.status='pendente');
  end if;
  update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
end $;
