CREATE OR REPLACE FUNCTION public.pitacco_ifood_complete(p_event uuid, p_lease uuid, p_order jsonb, p_test boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      (p_order-'merchant_id'-'created_at'-'contact_phone'-'contact_localizer'-'contact_expires_at')||jsonb_build_object('ifood_status',e.code,'ifood_test',p_test,'ifood_received_at',now()),
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
  -- Keep iFood telephone PII in a restricted table; do not expose to general receipt readers.
  if v_order_id is not null and p_order->>'logistics'='loja'
     and (nullif(p_order->>'contact_phone','') is not null
          or nullif(p_order->>'contact_localizer','') is not null) then
    insert into public.pitacco_delivery_customer_contacts(
      delivery_id,store_id,phone_number,phone_localizer,phone_expires_at,updated_at
    )
    select d.id,d.store_id,
      nullif(pg_catalog.left(p_order->>'contact_phone',64),''),
      nullif(pg_catalog.left(p_order->>'contact_localizer',32),''),
      case when pg_catalog.pg_input_is_valid(coalesce(p_order->>'contact_expires_at',''),
                 'timestamp with time zone')
           then (p_order->>'contact_expires_at')::timestamptz else null end,
      pg_catalog.now()
    from public.deliveries d
    where d.order_id=v_order_id and d.store_id=m.store_id and d.source='ifood'
      and d.logistics_provider='loja' and d.status not in ('cancelada','entregue')
    on conflict(delivery_id) do update
      set phone_number=coalesce(excluded.phone_number,public.pitacco_delivery_customer_contacts.phone_number),
          phone_localizer=coalesce(excluded.phone_localizer,public.pitacco_delivery_customer_contacts.phone_localizer),
          phone_expires_at=coalesce(excluded.phone_expires_at,public.pitacco_delivery_customer_contacts.phone_expires_at),
          updated_at=pg_catalog.now();
  end if;
  if v_order_id is not null and (e.code='CANCELLED' or p_order->>'logistics'='marketplace') then
    update public.deliveries d set external_delivery_status=e.code,
      status=case when e.code='CANCELLED' then 'cancelada' when e.code='CONCLUDED' then 'entregue' else d.status end
    where d.order_id=v_order_id and d.store_id=m.store_id and d.source='ifood'
      and (d.logistics_provider='marketplace' or d.status='pendente');
  end if;
  update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
end $function$
;
