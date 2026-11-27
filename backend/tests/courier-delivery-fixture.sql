create or replace function public.pitacco_driver_depart(p_batch uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.pitacco_courier_session_ready() then
    raise exception 'Sessão não liberada';
  end if;
  if not exists (
    select 1 from public.delivery_batches b
      join public.couriers c on c.id = b.courier_id
    where b.id = p_batch and c.active = true
      and c.user_id = (select auth.uid()) and c.store_id = b.store_id
  ) then raise exception 'Rota indisponível para este entregador'; end if;
  perform public.depart_route(p_batch);
end;
$$;
revoke all on function public.pitacco_driver_depart(uuid) from public, anon;
grant execute on function public.pitacco_driver_depart(uuid) to authenticated;

-- CI only: original documented collection, installed without changing other original functions.
create or replace function public.pitacco_driver_collect(p_delivery uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare d public.deliveries%rowtype;
begin
  if not public.pitacco_courier_session_ready() then
    raise exception 'Sessão não liberada';
  end if;
  select * into d from public.deliveries where id = p_delivery for update;
  if not found or d.logistics_provider <> 'loja' or
     d.courier_id is null or not public.is_courier(d.courier_id) then
    raise exception 'Entrega não atribuída a este entregador';
  end if;
  if d.batch_id is not null and exists (
    select 1 from public.delivery_batches b
    where b.id = d.batch_id and (b.departed_at is not null or b.completed_at is not null)
  ) then
    raise exception 'Rota já saiu da loja';
  end if;
  if d.status = 'aceita' and d.collected_at is not null then return; end if;
  if d.status not in ('atribuida','aceita') then raise exception 'Entrega não está aguardando coleta'; end if;
  update public.deliveries
     set status = 'aceita', collected_at = now(), updated_at = now()
   where id = d.id;
  insert into public.operation_audit(store_id,order_id,actor,action,details)
  values(d.store_id,d.order_id,(select auth.uid()),'courier_collected',
         jsonb_build_object('delivery',d.id,'route',d.batch_id));
end;
$$;
revoke all on function public.pitacco_driver_collect(uuid) from public, anon;
grant execute on function public.pitacco_driver_collect(uuid) to authenticated;

-- CI ONLY. Original own-delivery transitions and PIN rules.
create function core_auth.courier_delivery_fixture(p_action text,p_delivery uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb; route_store uuid;
begin
 perform core_auth.courier_shift_fixture('ready');
 if p_action='code_lengths' and p_delivery is null and p_code is null then
  select coalesce(jsonb_agg(item),'[]'::jsonb) into result
  from jsonb_array_elements(public.pitacco_driver_own_code_lengths()) item
  join public.deliveries d on d.id=(item->>'delivery_id')::uuid
  join public.couriers c on c.id=d.courier_id and c.user_id=auth.uid() and c.active
  join core_auth.memberships m on m.user_id=c.user_id and m.store_id=d.store_id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active;
  return result;
 end if;
 if p_action='depart_group' and p_code is null then
  -- Match the original store lock order before inspecting the route membership.
  select b.store_id into route_store from public.delivery_batches b
  join public.couriers c on c.id=b.courier_id and c.user_id=auth.uid() and c.active and c.store_id=b.store_id
  join core_auth.memberships m on m.user_id=c.user_id and m.store_id=b.store_id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active
  where b.id=p_delivery;
  if not found then raise exception 'Rota não autorizada' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(route_store::text,13));
  if exists(select 1 from public.deliveries d left join public.orders o on o.id=d.order_id and o.store_id=d.store_id
   join public.delivery_batches b on b.id=d.batch_id
   where d.batch_id=p_delivery and (d.source is distinct from 'proprio' or o.source is distinct from 'proprio' or d.logistics_provider is distinct from 'loja' or d.store_id is distinct from b.store_id or d.courier_id is distinct from b.courier_id)
  ) then raise exception 'Rota exige integração específica' using errcode='42501';end if;
  perform public.pitacco_driver_depart(p_delivery);
  return jsonb_build_object('departed',true);
 end if;
 if not exists(select 1 from public.deliveries d
  join public.couriers c on c.id=d.courier_id and c.user_id=auth.uid() and c.active
  join core_auth.memberships m on m.user_id=c.user_id and m.store_id=d.store_id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active
  join public.orders o on o.id=d.order_id and o.store_id=d.store_id
  where d.id=p_delivery and d.source='proprio' and o.source='proprio' and d.logistics_provider='loja'
 ) then raise exception 'Entrega não autorizada' using errcode='42501';end if;
 case p_action
 when 'collect' then
  perform public.pitacco_driver_collect(p_delivery);
  return jsonb_build_object('collected',true);
 when 'depart' then
  perform public.pitacco_driver_depart_single(p_delivery);
  return jsonb_build_object('departed',true);
 when 'arrive' then return public.pitacco_driver_arrive(p_delivery);
 when 'verify' then return public.pitacco_driver_verify_own_code(p_delivery,p_code);
 else raise exception 'Ação inválida' using errcode='22023';
 end case;
end $fn$;
revoke all on function core_auth.courier_delivery_fixture(text,uuid,text) from public,anon,authenticated;
create role pitacco_core_courier_delivery login password 'ci-courier-delivery-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_courier_delivery;
grant execute on function core_auth.courier_delivery_fixture(text,uuid,text) to pitacco_core_courier_delivery;


-- CI only: local iFood/mixed route collection and departure.
-- Return pending dispatch IDs, never claim a provider lease or mark DISPATCHED.
create function core_auth.courier_ifood_route_fixture(a text,target uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b public.delivery_batches%rowtype; result jsonb; rid uuid; v_delivery public.deliveries%rowtype; v_order public.orders%rowtype; payment jsonb;
begin
 perform core_auth.courier_shift_fixture('ready');
 if a in ('arrive','confirm_payment','verify_ready','reconcile') then
  select x.* into v_delivery from public.deliveries x
  join public.couriers c on c.id=x.courier_id and c.active and c.user_id=auth.uid() and c.store_id=x.store_id and c.fleet_type='propria'
  join core_auth.memberships m on m.user_id=c.user_id and m.store_id=x.store_id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active
  where x.id=target and x.source='ifood' and x.logistics_provider='loja' for update of x;
  if not found then raise exception 'Entrega não autorizada' using errcode='42501';end if;
  select x.* into v_order from public.orders x where x.id=v_delivery.order_id and x.store_id=v_delivery.store_id and x.source='ifood' for update;
  if not found then raise exception 'Pedido não autorizado' using errcode='42501';end if;
  if a='reconcile' then
   if v_delivery.status='entregue' then return jsonb_build_object('confirmed',true,'already',true);end if;
   if v_delivery.status<>'retirada' or v_delivery.collected_at is null or v_delivery.arrived_at is null or v_order.status<>'accepted' then raise exception 'Entrega não está disponível para conciliação' using errcode='22023';end if;
   payment:=pitacco_private.courier_payment_details(v_order.receipt,v_order.gross);
   if payment->>'state'='collect' then raise exception 'Confirme o recebimento antes da conclusão' using errcode='22023';end if;
   -- The original RPC requires both CONCLUDED receipt and processed private
   -- event for the linked external order and merchant after local arrival.
   -- It never claims the customer's PIN was verified.
   -- Explicitly require post-arrival evidence at the Core boundary, regardless
   -- of historical compatibility tolerances in the legacy function.
   if v_order.receipt->>'ifood_status' is distinct from 'CONCLUDED' or not exists(
    select 1 from pitacco_private.ifood_order_links l
    join pitacco_private.ifood_merchants m on m.merchant_id=l.merchant_id and m.store_id=v_order.store_id
    join pitacco_private.ifood_events e on e.order_id=l.external_id and e.merchant_id=l.merchant_id
    where l.order_id=v_order.id and e.code='CONCLUDED' and e.done_at is not null and e.event_at>=v_delivery.arrived_at
   ) then return jsonb_build_object('confirmed',false,'pending',true);end if;
   return public.pitacco_driver_reconcile_ifood(target);
  end if;
  if a='verify_ready' and v_delivery.status='entregue' then return jsonb_build_object('eligible',false,'delivered',true);end if;
  if v_delivery.status<>'retirada' or v_delivery.collected_at is null or v_order.status<>'accepted' or coalesce(v_order.receipt->>'ifood_status','')='CANCELLED' then raise exception 'Entrega não está em rota' using errcode='22023';end if;
  if a='arrive' then
   result:=public.pitacco_driver_arrive(target);
   return result||jsonb_build_object('dispatch_confirmed',coalesce(v_order.receipt->>'ifood_status','')='DISPATCHED');
  end if;
  if v_delivery.arrived_at is null then raise exception 'Registre a chegada primeiro' using errcode='22023';end if;
  if a='confirm_payment' then return public.pitacco_driver_confirm_payment(target);end if;
  payment:=pitacco_private.courier_payment_details(v_order.receipt,v_order.gross);
  if payment->>'state'='collect' then raise exception 'Confirme o recebimento antes do código' using errcode='22023';end if;
  return jsonb_build_object('eligible',true,'delivered',false);
 end if;
 if a='collect' then
  select d.batch_id into rid from public.deliveries d where d.id=target;
 elsif a='depart_group' then rid:=target;
 else raise exception 'Ação inválida' using errcode='22023';end if;
 select x.* into b from public.delivery_batches x
 join public.couriers c on c.id=x.courier_id and c.user_id=auth.uid() and c.active and c.store_id=x.store_id and c.fleet_type='propria'
 join core_auth.memberships m on m.user_id=c.user_id and m.store_id=x.store_id and m.active and m.role='courier'
 join core_auth.stores st on st.id=m.store_id and st.active where x.id=rid;
 if not found then raise exception 'Rota não autorizada' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(b.store_id::text,13));
 select * into b from public.delivery_batches where id=rid for update;
 perform 1 from public.deliveries d where d.batch_id=rid order by d.id for update;
 if not exists(select 1 from public.deliveries d where d.batch_id=rid and d.source='ifood' and d.status not in ('cancelada','entregue')) or exists(
 select 1 from public.deliveries d left join public.orders o on o.id=d.order_id and o.store_id=d.store_id
 where d.batch_id=rid and (d.store_id is distinct from b.store_id or d.courier_id is distinct from b.courier_id or d.logistics_provider is distinct from 'loja' or d.source not in ('proprio','ifood') or o.source is distinct from d.source)
 ) then raise exception 'Rota exige integração específica' using errcode='42501';end if;
 if b.completed_at is not null then raise exception 'Rota encerrada' using errcode='22023';end if;
 if b.departed_at is null and exists(
 select 1 from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id
 where d.batch_id=rid and d.status<>'cancelada' and (o.status<>'accepted' or o.preparation_status<>'ready' or d.capacity_released_at is not null or coalesce(d.external_delivery_status,'') in ('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN') or (d.source='ifood' and (coalesce(o.receipt->>'ifood_status','') not in ('CONFIRMED','READY_TO_PICKUP') or coalesce(o.receipt->>'ifood_manual_cancel','')='requested')))
 ) then raise exception 'Pedido não está liberado' using errcode='22023';end if;
 if a='collect' then
  if b.departed_at is not null or not exists(select 1 from public.deliveries d where d.id=target and d.batch_id=rid and d.status in ('atribuida','aceita')) then raise exception 'Coleta indisponível' using errcode='22023';end if;
  perform public.pitacco_driver_collect(target);
  return jsonb_build_object('collected',true);
 end if;
 if b.departed_at is null then
  if exists(select 1 from public.deliveries d where d.batch_id=rid and d.status<>'cancelada' and (d.status<>'aceita' or d.collected_at is null)) then raise exception 'Confirme todas as coletas' using errcode='22023';end if;
  perform public.pitacco_driver_depart(rid);
 end if;
 select coalesce(jsonb_agg(d.id order by d.id),'[]'::jsonb) into result
 from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id
 where d.batch_id=rid and d.source='ifood' and d.status='retirada' and d.collected_at is not null and o.status='accepted'
 and coalesce(o.receipt->>'ifood_status','') in ('CONFIRMED','READY_TO_PICKUP');
 return jsonb_build_object('departed',true,'pending_ifood_dispatch',result);
end $fn$;
revoke all on function core_auth.courier_ifood_route_fixture(text,uuid) from public,anon,authenticated;
grant execute on function core_auth.courier_ifood_route_fixture(text,uuid) to pitacco_core_courier_delivery;
