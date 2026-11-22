-- Isolado/rollback: teste de baixa de insumos, embalagens e adicionais selecionados.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000091','inventory-options-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000092','inventory-options-other@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000091','Estoque com complementos'),
 ('20000000-0000-0000-0000-000000000092','Outra loja complementos');
insert into public.store_members(store_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091','gestor'),
 ('20000000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000092','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values ('20000000-0000-0000-0000-000000000091','estoque-complementos-teste',true,true,true,0,array['pix_manual'],'');
insert into public.products(id,store_id,name,price,cost,menu_active) values
 ('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','Açaí teste',20,0,true),
 ('30000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000092','Produto de outra loja',20,0,true);
insert into public.product_option_groups(id,store_id,product_id,name,min_select,max_select)
 values ('40000000-0000-0000-0000-000000000091',
 '20000000-0000-0000-0000-000000000091',
 '30000000-0000-0000-0000-000000000091','Adicionais',0,2);
insert into public.product_options(id,store_id,group_id,name,additional_price) values
 ('50000000-0000-0000-0000-000000000091',
 '20000000-0000-0000-0000-000000000091',
 '40000000-0000-0000-0000-000000000091','Nutella',3.50);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000091',true);
insert into public.pitacco_ingredients(id,store_id,name,unit,minimum) values
 ('60000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','Polpa de açaí','g',100),
 ('60000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000091','Nutella','g',50),
 ('60000000-0000-0000-0000-000000000093','20000000-0000-0000-0000-000000000091','Copo e tampa','un',3);
insert into public.pitacco_stock_movements(store_id,ingredient_id,quantity,reason)
 values
 ('20000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000091',1000,'Estoque teste'),
 ('20000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000092',200,'Estoque teste'),
 ('20000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000093',10,'Estoque teste');
insert into public.pitacco_recipe_lines(store_id,product_id,ingredient_id,quantity) values
 ('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000091',200),
 ('20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000093',1);
insert into public.pitacco_option_recipe_lines(store_id,option_id,ingredient_id,quantity) values
 ('20000000-0000-0000-0000-000000000091','50000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000091',50),
 ('20000000-0000-0000-0000-000000000091','50000000-0000-0000-0000-000000000091','60000000-0000-0000-0000-000000000092',30);
do $test$
begin
 begin
  insert into public.pitacco_option_recipe_lines(store_id,option_id,ingredient_id,quantity)
  values('20000000-0000-0000-0000-000000000091',
   '50000000-0000-0000-0000-000000000091',
   '60000000-0000-0000-0000-000000000092',1);
  raise exception 'Não deveria permitir insumo de outra loja';
 exception when unique_violation then null;
 end;
end $test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.checkout_public_order(
 'estoque-complementos-teste','70000000-0000-0000-0000-000000000091',
 'Cliente Teste','21999999999','',
 '[{"product_id":"30000000-0000-0000-0000-000000000091","quantity":2,"options":["50000000-0000-0000-0000-000000000091"]}]'::jsonb,
 'pickup','pix_manual','');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000091',true);
do $test$
declare oid uuid;
begin
 select o.id into oid from public.orders o where o.request_id='70000000-0000-0000-0000-000000000091';
 assert oid is not null,'Checkout deve gerar pedido';
 assert (select o.receipt #>> '{items,0,modifiers,0,option_id}' from public.orders o where o.id=oid)
  ='50000000-0000-0000-0000-000000000091','Complemento escolhido preserva ID no recibo do servidor';
 assert (select sum(balance)=1210 from public.pitacco_ingredients where store_id='20000000-0000-0000-0000-000000000091'),
  'Pedido pendente não consome ingredientes';
 perform public.accept_order(oid);
 perform public.accept_order(oid);
 assert (select balance=500 from public.pitacco_ingredients where id='60000000-0000-0000-0000-000000000091'),
  '2 x (200g produto + 50g adicional) consumidos exatamente uma vez';
 assert (select balance=140 from public.pitacco_ingredients where id='60000000-0000-0000-0000-000000000092'),
  '2 x 30g Nutella descontados';
 assert (select balance=8 from public.pitacco_ingredients where id='60000000-0000-0000-0000-000000000093'),
  'Duas embalagens descontadas';
 assert (select count(*)=3 from public.pitacco_stock_movements where order_id=oid),
  'Um único movimento consolidado por insumo, sem duplicidade';
 assert (select count(*)=1 from public.pitacco_stock_movements
  where order_id=oid and ingredient_id='60000000-0000-0000-0000-000000000091' and quantity=-500);
end $test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000092',true);
do $test$
begin
 assert not exists (select 1 from public.pitacco_option_recipe_lines),
  'Outra loja não pode ler fichas de complementos';
 begin
  insert into public.pitacco_option_recipe_lines(store_id,option_id,ingredient_id,quantity)
  values('20000000-0000-0000-0000-000000000091',
   '50000000-0000-0000-0000-000000000091',
   '60000000-0000-0000-0000-000000000093',5);
  raise exception 'Outra loja não pode gravar fichas';
 exception when insufficient_privilege then null;
 end;
end $test$;
rollback;
