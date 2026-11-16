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

insert into pitacco_private.commission_enrollments(store_id,starts_at)
 values ('20000000-0000-0000-0000-000000000001',now()-interval '1 day');
set local role anon;
do $regression$
declare
 first_line jsonb := '{"product_id":"30000000-0000-0000-0000-000000000001","quantity":1,"options":["50000000-0000-0000-0000-000000000001"]}';
 second_line jsonb := '{"product_id":"30000000-0000-0000-0000-000000000001","quantity":2,"options":["50000000-0000-0000-0000-000000000002"]}';
 key uuid := '60000000-0000-0000-0000-000000000001';
 result jsonb;
 replay jsonb;
 tracking jsonb;
begin
 result:=public.checkout_public_order('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line,second_line),'delivery','pix_manual');
 assert (result->>'total')::numeric=73, 'Prices and modifiers are calculated per variant, with delivery';
 assert result->>'payment_status'='pending', 'Manual Pix remains pending';
 replay:=public.checkout_public_order('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(second_line,first_line),'delivery','pix_manual');
 assert replay=result, 'Reordered variants retry the same order';
 tracking:=public.pitacco_track_public_order((result->>'tracking_token')::uuid);
 assert jsonb_array_length(tracking->'items')=2 and not tracking ? 'phone', 'Tracking includes both variants without the phone';

 begin
  perform public.checkout_public_order('checkout-fixture',gen_random_uuid(),'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line,first_line),'delivery','pix_manual');
  raise exception 'Expected duplicate line rejection';
 exception when raise_exception then
  if sqlerrm <> 'Combine itens com os mesmos complementos em uma única linha' then raise; end if;
 end;
 begin
  perform public.checkout_public_order('checkout-fixture',gen_random_uuid(),'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line-'options'),'delivery','pix_manual');
  raise exception 'Expected required modifier rejection';
 exception when raise_exception then
  if sqlerrm not like 'Quantidade de escolhas inválida no grupo %' then raise; end if;
 end;

 key:=gen_random_uuid();
 result:=public.checkout_public_order_coupon('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(first_line,second_line),'delivery','pix_manual','','TESTE10');
 assert (result->>'total')::numeric=66.20, 'The coupon applies to the server-calculated subtotal';
 replay:=public.checkout_public_order_coupon('checkout-fixture',key,'Cliente','11999999999','Rua de teste 123',jsonb_build_array(second_line,first_line),'delivery','pix_manual','','TESTE10');
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
 assert (select count(*) from public.orders)=2, 'Replays did not duplicate orders';
 assert (select count(*) from pitacco_private.commission_orders)=2, 'Replays did not duplicate commission records';
 assert exists(select 1 from pitacco_private.commission_orders where product_cents=6800 and discount_cents=680 and delivery_cents=500 and completed_at is null),
  'The real checkout persists the server-computed items, coupon and freight separately';
end
$regression$;
rollback;
