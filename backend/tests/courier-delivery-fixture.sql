-- CI ONLY. Original own-delivery transitions and PIN rules.
create function core_auth.courier_delivery_fixture(p_action text,p_delivery uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
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
 if not exists(select 1 from public.deliveries d
  join public.couriers c on c.id=d.courier_id and c.user_id=auth.uid() and c.active
  join core_auth.memberships m on m.user_id=c.user_id and m.store_id=d.store_id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active
  join public.orders o on o.id=d.order_id and o.store_id=d.store_id
  where d.id=p_delivery and d.source='proprio' and o.source='proprio' and d.logistics_provider='loja'
 ) then raise exception 'Entrega não autorizada' using errcode='42501';end if;
 case p_action
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
