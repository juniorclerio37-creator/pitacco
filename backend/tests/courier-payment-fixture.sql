-- CI ONLY. Original payment functions remain unchanged. No provider calls.
create function core_auth.courier_payment_fixture(p_action text,p_delivery uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
begin
 -- Reuse the previously validated session bridge, not the GPS capability.
 perform core_auth.courier_shift_fixture('ready');
 if p_action='cards' and p_delivery is null then
  select coalesce(jsonb_agg(item),'[]'::jsonb) into result
  from jsonb_array_elements(public.pitacco_driver_payment_cards()) item
  join public.deliveries d on d.id=(item->>'delivery_id')::uuid
  join public.couriers c on c.id=d.courier_id and c.user_id=auth.uid() and c.active
  join core_auth.memberships m on m.user_id=c.user_id and m.store_id=d.store_id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active
  where d.source='proprio' and d.logistics_provider='loja';
  return result;
 elsif p_action='confirm' and p_delivery is not null then
  -- Restrict this test bridge to own orders; never invoke marketplace payment flows.
  if not exists(select 1 from public.deliveries d
   join public.couriers c on c.id=d.courier_id and c.user_id=auth.uid() and c.active
   join core_auth.memberships m on m.user_id=c.user_id and m.store_id=d.store_id and m.active and m.role='courier'
   join core_auth.stores st on st.id=m.store_id and st.active
   join public.orders o on o.id=d.order_id and o.store_id=d.store_id
   where d.id=p_delivery and d.source='proprio' and o.source='proprio' and d.logistics_provider='loja'
  ) then raise exception 'Entrega não autorizada' using errcode='42501';end if;
  return public.pitacco_driver_confirm_payment(p_delivery);
 end if;
 raise exception 'Ação inválida' using errcode='22023';
end $fn$;
revoke all on function core_auth.courier_payment_fixture(text,uuid) from public,anon,authenticated;
create role pitacco_core_courier_payment login password 'ci-courier-payment-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_courier_payment;
grant execute on function core_auth.courier_payment_fixture(text,uuid) to pitacco_core_courier_payment;
insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values
('98000000-0000-0000-0000-000000000011','20000000-0000-4000-8000-000000000001','Delivery próprio',34,'proprio','accepted','ready','{"payment":"dinheiro","logistics":"loja","change_for":50,"delivery_fee":9}'),
('98000000-0000-0000-0000-000000000012','20000000-0000-4000-8000-000000000001','Delivery próprio',25,'proprio','accepted','ready','{"payment":"pix_manual","logistics":"loja"}');
insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,source,logistics_provider,collected_at,arrived_at) values
('98000000-0000-0000-0000-000000000021','20000000-0000-4000-8000-000000000001','98000000-0000-0000-0000-000000000011','98000000-0000-0000-0000-000000000002','Cliente Fixture','Rua Fixture','atribuida','proprio','loja',null,null),
('98000000-0000-0000-0000-000000000022','20000000-0000-4000-8000-000000000001','98000000-0000-0000-0000-000000000012','98000000-0000-0000-0000-000000000002','Cliente Fixture','Rua Fixture','retirada','proprio','loja',now(),now());
