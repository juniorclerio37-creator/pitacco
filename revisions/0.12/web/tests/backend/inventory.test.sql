begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','inventory-one@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','inventory-two@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','inventory-staff@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Inventory Store'),
 ('20000000-0000-0000-0000-000000000002','Other Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','lojista');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values ('20000000-0000-0000-0000-000000000001','inventory-test',true,true,true,0,array['pix_manual'],'');
insert into public.products(id,store_id,name,price,cost,menu_active) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Açaí',20,0,true),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Outro Açaí',20,0,true);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare ingredient uuid;
begin
 insert into public.pitacco_ingredients(store_id,name,unit,minimum)
 values ('20000000-0000-0000-0000-000000000001','Polpa de açaí','g',100) returning id into ingredient;
 insert into public.pitacco_stock_movements(id,store_id,ingredient_id,quantity,reason)
 values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',ingredient,500,'Compra')
 on conflict (id) do nothing;
 insert into public.pitacco_stock_movements(id,store_id,ingredient_id,quantity,reason)
 values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',ingredient,500,'Compra')
 on conflict (id) do nothing;
 insert into public.pitacco_recipe_lines(store_id,product_id,ingredient_id,quantity)
 values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',ingredient,200);
 assert (select balance=500 from public.pitacco_ingredients where id=ingredient);
 begin
  insert into public.pitacco_recipe_lines(store_id,product_id,ingredient_id,quantity)
  values ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',ingredient,1);
  raise exception 'Expected the ingredient recipe to reject a product from another establishment';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.checkout_public_order('inventory-test','50000000-0000-0000-0000-000000000001','Cliente','21999999999','',
 '[{"product_id":"30000000-0000-0000-0000-000000000001","quantity":2}]','pickup','pix_manual','');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare order_number uuid;
begin
 select id into order_number from public.orders where request_id='50000000-0000-0000-0000-000000000001';
 assert (select balance=500 from public.pitacco_ingredients), 'A pending order does not consume stock';
 perform public.accept_order(order_number);
 perform public.accept_order(order_number);
 assert (select balance=100 from public.pitacco_ingredients), 'Acceptance consumes quantity from the recipe exactly once';
 assert (select count(*)=1 from public.pitacco_stock_movements where order_id=order_number and quantity=-400), 'One immutable movement is linked to the order';
end;
$test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $test$
begin
 assert exists(select 1 from public.pitacco_ingredients), 'Store staff can view stock';
 begin
  insert into public.pitacco_ingredients(store_id,name,unit)
  values ('20000000-0000-0000-0000-000000000001','New Ingredient','g');
  raise exception 'Expected staff without supervisor permission to be unable to write stock';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
 assert not exists(select 1 from public.pitacco_ingredients), 'Other stores do not see these ingredients';
 assert not exists(select 1 from public.pitacco_stock_movements), 'Other stores do not see these movements';
 assert not exists(select 1 from public.pitacco_recipe_lines), 'Other stores do not see these recipes';
end;
$test$;
rollback;
