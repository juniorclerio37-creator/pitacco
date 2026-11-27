-- CI-only original courier receipt flow. No external provider or real customer.
begin;
insert into auth.users(id,email) values
 ('96000000-0000-0000-0000-000000000001','courier-receipt-fixture@example.invalid'),
 ('96000000-0000-0000-0000-000000000002','other-courier-fixture@example.invalid');
insert into public.profiles(id,email,role) values
 ('96000000-0000-0000-0000-000000000001','courier-receipt-fixture@example.invalid','entregador'),
 ('96000000-0000-0000-0000-000000000002','other-courier-fixture@example.invalid','entregador')
 on conflict(id) do update set role=excluded.role;
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
-- Verify fixture identity under the database owner, not by granting access to the private helper.
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000006"}',true);
do $fixture$
begin
 assert public.pitacco_courier_session_ready(), 'Synthetic outsider courier session is not ready';
end $fixture$;
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000006"}',true);
do $test$
begin
 begin
  perform public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
  raise exception 'Expected assignment isolation';
 exception when insufficient_privilege then if sqlerrm not like 'Entrega não atribuída%' then raise; end if; end;
end $test$;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000005"}',true);
do $test$
begin
 begin
  perform public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
  raise exception 'Expected arrival requirement';
 exception when sqlstate '22023' then if sqlerrm not like 'Registre a chegada%' then raise; end if; end;
end $test$;
-- Exercise session denial through the existing authorized entry point, not a private helper.
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000006"}',true);
do $test$
begin
 begin
  perform public.pitacco_driver_confirm_payment('96000000-0000-0000-0000-000000000008');
  raise exception 'Expected invalid session denial';
 exception when insufficient_privilege then if sqlerrm not like 'Sessão do entregador não autorizada%' then raise; end if; end;
end $test$;
select set_config('request.jwt.claims','{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"96000000-0000-0000-0000-000000000005"}',true);
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

-- Use the actual receipt shape produced by the ten Laravel delivery checkouts.
-- All clones and declarations remain inside the rolled-back test transaction.
do $test$
declare
 s constant uuid:='91000000-0000-0000-0000-000000000002';
 courier constant uuid:='96000000-0000-0000-0000-000000000003';
 methods constant text[]:=array['dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket','pix_manual'];
 method text; i integer:=0; source_receipt jsonb; gross_value numeric; oid uuid; did uuid; r jsonb; card jsonb; replay jsonb;
begin
 foreach method in array methods loop
  select o.receipt,o.gross into strict source_receipt,gross_value
  from public.orders o join public.public_checkouts c on c.order_id=o.id and c.store_id=o.store_id
  where c.store_id=s and c.phone='21988887'||lpad((200+i)::text,3,'0') and o.receipt->>'payment'=method;
  assert gross_value=34;
  oid:=gen_random_uuid();did:=gen_random_uuid();
  insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt)
   values(oid,s,'Delivery próprio',gross_value,'proprio','accepted','ready',source_receipt);
  insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,source,logistics_provider,collected_at,arrived_at)
   values(did,s,oid,courier,'Cliente fictício','Endereço fictício','retirada','proprio','loja',now(),now());
  select item->'payment' into strict card from jsonb_array_elements(public.pitacco_driver_payment_cards()) item where item->>'delivery_id'=did::text;
  assert card->>'received_by_courier'='false';
  if method='pix_manual' then
   assert card->>'state'<>'collect';
   begin
    perform public.pitacco_driver_confirm_payment(did);
    raise exception 'Expected manual Pix denial';
   exception when sqlstate '22023' then if sqlerrm not like 'Este pedido não possui cobrança%' then raise;end if;end;
   assert not exists(select 1 from public.operation_audit where order_id=oid and action='courier_payment_received');
  else
   assert card->>'state'='collect' and (card->>'amount')::numeric=34;
   if method='dinheiro' then
    assert (card->>'change_for')::numeric=50 and (card->>'change_due')::numeric=16;
   end if;
   begin
    update public.deliveries set status='entregue',delivery_code_verified_at=now() where id=did;
    raise exception 'Expected collection gate';
   exception when check_violation then
    if sqlerrm not like 'Confirme o recebimento%' then raise;end if;
   end;
   r:=public.pitacco_driver_confirm_payment(did);
   replay:=public.pitacco_driver_confirm_payment(did);
   assert r=replay and r->>'state'='paid' and (r->>'amount')::numeric=34;
   assert (select count(*)=1 from public.operation_audit where order_id=oid and action='courier_payment_received');
   assert (select status='retirada' from public.deliveries where id=did);
   assert (select (receipt#>>'{courier_collection,amount}')::numeric=34 from public.orders where id=oid);
  end if;
  i:=i+1;
 end loop;
 -- Fiado privacy: no amount, limit, debt or due date in the courier's payment card.
 oid:=gen_random_uuid();did:=gen_random_uuid();
 insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt)
 values(oid,s,'Delivery próprio',34,'proprio','accepted','ready','{"payment":"fiado","logistics":"loja"}');
 insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,source,logistics_provider,collected_at,arrived_at)
 values(did,s,oid,courier,'Cliente fictício','Endereço fictício','retirada','proprio','loja',now(),now());
 select item->'payment' into strict card from jsonb_array_elements(public.pitacco_driver_payment_cards()) item where item->>'delivery_id'=did::text;
 assert card->>'state'='no_collect' and card->>'method'='Sem cobrança na entrega' and card->>'amount' is null;
 assert not (card ?| array['limit','outstanding','next_due','fiado']);
 begin
  perform public.pitacco_driver_confirm_payment(did);
  raise exception 'Expected deferred payment denial';
 exception when sqlstate '22023' then if sqlerrm not like 'Este pedido não possui cobrança%' then raise;end if;end;
 assert not exists(select 1 from public.operation_audit where order_id=oid and action='courier_payment_received');
 raise notice 'PASS: courier cards and receipt confirmations across nine collection methods, manual Pix, Fiado privacy, exact amount, change, completion gate and idempotency';
end $test$;
rollback;
