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

