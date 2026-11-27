begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','manager-one@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','manager-two@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Test Store'),
 ('20000000-0000-0000-0000-000000000002','Other Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values ('20000000-0000-0000-0000-000000000001','checkout-fixture',true,true,true,5,array['pix_manual'],'Pix de teste')
on conflict (store_id) do update set slug=excluded.slug, enabled=excluded.enabled, delivery_enabled=excluded.delivery_enabled, pickup_enabled=excluded.pickup_enabled, delivery_fee=excluded.delivery_fee, payment_methods=excluded.payment_methods, pix_instructions=excluded.pix_instructions;
insert into public.products(id,store_id,name,price,cost,menu_active)
 values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Açaí',20,0,true);
insert into public.product_option_groups(id,store_id,product_id,name,min_select,max_select)
 values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Complemento',1,1);
insert into public.product_options(id,group_id,store_id,name,additional_price) values
 ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Morango',2),
 ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Leite em pó',3);
insert into public.loyalty_coupons(store_id,code,discount_type,discount_value,max_uses)
 values ('20000000-0000-0000-0000-000000000001','TESTE10','percent',10,1);
update public.loyalty_coupons set starts_at=now()-interval '1 day' where code='TESTE10';
insert into public.loyalty_coupons(store_id,code,discount_type,discount_value,starts_at,expires_at)
 values ('20000000-0000-0000-0000-000000000001','FUTURO','percent',10,now()+interval '1 day',now()+interval '2 days'),
 ('20000000-0000-0000-0000-000000000001','VENCIDO','percent',10,now()-interval '2 days',now()-interval '1 day');

set local role anon;
do $regression$
declare
 first_line jsonb := '{"product_id":"30000000-0000-0000-0000-000000000001","quantity":1,"options":["50000000-0000-0000-0000-000000000001"]}';
 second_line jsonb := '{"product_id":"30000000-0000-0000-0000-000000000001","quantity":2,"options":["50000000-0000-0000-0000-000000000002"]}';
 key uuid := '60000000-0000-0000-0000-000000000001';
 result jsonb;
 replay jsonb;
 tracking jsonb;
 invalid_coupon text;
begin
 foreach invalid_coupon in array array['FUTURO','VENCIDO'] loop
  begin
   perform public.checkout_public_order_coupon('checkout-fixture',gen_random_uuid(),'Cliente','11999999999','Rua de teste 123',
     jsonb_build_array(first_line),'pickup','pix_manual','',invalid_coupon);
   raise exception 'Cupom fora do período não pode ser usado';
  exception when raise_exception then
   if sqlerrm <> 'Cupom indisponível ou expirado' then raise;end if;
  end;
 end loop;
 result:=public.checkout_public_order('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line,second_line),'pickup','pix_manual');
 assert (result->>'total')::numeric=68, 'Prices and modifiers are calculated per variant; pickup has no freight';
 assert result->>'payment_status'='pending', 'Manual Pix remains pending';
 replay:=public.pitacco_public_checkout_recovery('checkout-fixture',key);
 assert replay->>'confirmed'='true' and replay->>'order_id'=result->>'order_id'
  and replay->>'tracking_token'=result->>'tracking_token', 'Anonymous recovery finds only its confirmed request';
 assert (select count(*) from jsonb_object_keys(replay))=4, 'Recovery contains only confirmation, order ID, tracking token and total';
 assert public.pitacco_public_checkout_recovery('other-store',key)='{"confirmed":false}'::jsonb, 'Store cannot recover another store request';
 assert public.pitacco_public_checkout_recovery('checkout-fixture',gen_random_uuid())='{"confirmed":false}'::jsonb, 'Unknown request cannot enumerate orders';
 assert public.pitacco_public_checkout_recovery('checkout-fixture',null)='{"confirmed":false}'::jsonb, 'Missing request reveals nothing';

 replay:=public.checkout_public_order('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(second_line,first_line),'pickup','pix_manual');
 assert replay=result, 'Reordered variants retry the same order';
 tracking:=public.pitacco_track_public_order((result->>'tracking_token')::uuid);
 assert jsonb_array_length(tracking->'items')=2 and not tracking ? 'phone', 'Tracking includes both variants without the phone';

 begin
  perform public.checkout_public_order('checkout-fixture',gen_random_uuid(),'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line,first_line),'pickup','pix_manual');
  raise exception 'Expected duplicate line rejection';
 exception when raise_exception then
  if sqlerrm <> 'Combine itens com os mesmos complementos em uma única linha' then raise; end if;
 end;
 begin
  perform public.checkout_public_order('checkout-fixture',gen_random_uuid(),'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line-'options'),'pickup','pix_manual');
  raise exception 'Expected required modifier rejection';
 exception when raise_exception then
  if sqlerrm not like 'Quantidade de escolhas inválida no grupo %' then raise; end if;
 end;

 key:=gen_random_uuid();
 result:=public.checkout_public_order_coupon('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line,second_line),'pickup','pix_manual','','TESTE10');
 assert (result->>'total')::numeric=61.20, 'The coupon applies to the server-calculated subtotal';
 replay:=public.checkout_public_order_coupon('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(second_line,first_line),'pickup','pix_manual','','TESTE10');
 assert replay=result, 'Replay does not use the coupon twice';
end;
$regression$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $regression$
begin
 assert not exists(select 1 from public.orders where store_id='20000000-0000-0000-0000-000000000001'), 'Unrelated managers cannot read checkout orders';
end
$regression$;
reset role;
do $regression$
begin
 assert (select uses from public.loyalty_coupons where code='TESTE10')=1, 'Coupon was used exactly once';
 assert (select sum(uses)=0 from public.loyalty_coupons where code in ('FUTURO','VENCIDO')),
   'Cupons fora do período não consomem utilizações';
 assert (select count(*) from public.orders)=2, 'Replays did not duplicate orders';
end
$regression$;
rollback;
