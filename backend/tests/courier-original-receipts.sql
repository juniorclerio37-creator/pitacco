-- CI-only original courier receipt flow. No external provider or real customer.
begin;
insert into auth.users(id,email) values
 ('96000000-0000-0000-0000-000000000001','courier-receipt-fixture@example.invalid'),
 ('96000000-0000-0000-0000-000000000002','other-courier-fixture@example.invalid');
insert into public.profiles(id,email,role) values
 ('96000000-0000-0000-0000-000000000001','courier-receipt-fixture@example.invalid','entregador'),
 ('96000000-0000-0000-0000-000000000002','other-courier-fixture@example.invalid','entregador')
 on conflict(id) do nothing;
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available) values
 ('96000000-0000-0000-0000-000000000003','96000000-0000-0000-0000-000000000001','Entregador fictício','propria','91000000-0000-0000-0000-000000000002',true,true),
 ('96000000-0000-0000-0000-000000000004','96000000-0000-0000-0000-000000000002','Outro entregador fictício','propria','91000000-0000-0000-0000-000000000002',true,true);
insert into public.pitacco_courier_auth_state(user_id,store_id,must_change_password,credentials_issued_at) values
 ('96000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002',false,now()-interval '1 minute'),
 ('96000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000002',false,now()-interval '1 minute');
insert into auth.sessions(id,user_id) values
 ('96000000-0000-0000-0000-000000000005','96000000-0000-0000-0000-000000000001'),
 ('96000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000002');
insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values
 ('96000000-0000-0000-0000-000000000007','91000000-0000-0000-0000-000000000002','Delivery próprio',34,'proprio','accepted','ready','{"payment":"dinheiro","logistics":"loja","change_for":50,"delivery_fee":9}');
insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,source,logistics_provider,collected_at) values
 ('96000000-0000-0000-0000-000000000008','91000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000007','96000000-0000-0000-0000-000000000003','Cliente fictício','Endereço fictício','retirada','proprio','loja',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000006"}',true);
do $test$
begin
 assert public.pitacco_courier_session_ready();
 begin
  perform public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
  raise exception 'Expected assignment isolation';
 exception when insufficient_privilege then null; end;
end $test$;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000005"}',true);
do $test$
begin
 assert public.pitacco_courier_session_ready();
 begin
  perform public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
  raise exception 'Expected arrival requirement';
 exception when sqlstate '22023' then assert sqlerrm like 'Registre a chegada%'; end;
end $test$;
reset role;
update public.deliveries set arrived_at=now() where id='96000000-0000-0000-0000-000000000008';
set local role authenticated;
do $test$
declare r jsonb; replay jsonb;
begin
 r:=public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
 assert r->>'state'='paid' and r->>'received_by_courier'='true';
 assert (r->>'amount')::numeric=34;
 replay:=public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
 assert replay=r;
end $test$;
reset role;
do $test$
begin
 assert (select count(*)=1 from public.operation_audit where order_id='96000000-0000-0000-0000-000000000007' and action='courier_payment_received');
 assert (select status='retirada' from public.deliveries where id='96000000-0000-0000-0000-000000000008');
 assert not has_function_privilege('anon','public.pitacco_driver_confirm_payment(uuid)','execute');
 raise notice 'PASS: original courier receipt, assigned courier session, arrival, exact amount, idempotency and unchanged delivery status';
end $test$;
rollback;
