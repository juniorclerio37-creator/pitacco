-- Regressão transacional sem escrita persistente:
-- alimentos nunca retornam; bebidas marcadas no catálogo exigem lacre
-- confirmado, foto de consumo, limite de unidades e idempotência.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000097','beverage-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000098','beverage-outsider@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000097','Loja teste bebida recuperada'),
 ('20000000-0000-0000-0000-000000000098','Loja não autorizada');
insert into public.store_members(store_id,user_id,role) values
 ('20000000-0000-0000-0000-000000000097','10000000-0000-0000-0000-000000000097','gestor'),
 ('20000000-0000-0000-0000-000000000098','10000000-0000-0000-0000-000000000098','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values ('20000000-0000-0000-0000-000000000097','teste-bebida-cancelamento',true,true,true,0,array['pix_manual'],'')
 on conflict(store_id) do update set slug=excluded.slug,enabled=excluded.enabled,
 delivery_enabled=excluded.delivery_enabled,pickup_enabled=excluded.pickup_enabled,
 delivery_fee=excluded.delivery_fee,payment_methods=excluded.payment_methods,pix_instructions=excluded.pix_instructions;
insert into public.products(id,store_id,name,price,cost,menu_active,category,sealed_industrial_beverage) values
 ('30000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000097',
 'Açaí preparado',22,0,true,'Açaí',false),
 ('30000000-0000-0000-0000-000000000098','20000000-0000-0000-0000-000000000097',
 'Refrigerante lacrado',8,0,true,'Bebidas',true);
insert into public.pitacco_ingredients(id,store_id,name,unit,minimum) values
 ('40000000-0000-0000-0000-000000000097','20000000-0000-0000-0000-000000000097','Açaí','g',0),
 ('40000000-0000-0000-0000-000000000098','20000000-0000-0000-0000-000000000097','Copo','un',0),
 ('40000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000097','Refrigerante fechado','un',0);
insert into public.pitacco_stock_movements(store_id,ingredient_id,quantity,reason)
values
 ('20000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000097',1000,'Teste sem pedidos'),
 ('20000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000098',10,'Teste sem pedidos'),
 ('20000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000099',10,'Teste sem pedidos');
insert into public.pitacco_recipe_lines(store_id,product_id,ingredient_id,quantity)
values
 ('20000000-0000-0000-0000-000000000097','30000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000097',200),
 ('20000000-0000-0000-0000-000000000097','30000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000098',1),
 ('20000000-0000-0000-0000-000000000097','30000000-0000-0000-0000-000000000098','40000000-0000-0000-0000-000000000099',1);
insert into public.pitacco_ingredient_unit_costs(store_id,ingredient_id,cost_per_unit)
values
 ('20000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000097',0.015),
 ('20000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000098',0.50),
 ('20000000-0000-0000-0000-000000000097','40000000-0000-0000-0000-000000000099',4.00);

-- Checkout tem dois itens: 1 alimento preparado e 2 bebidas lacradas.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.checkout_public_order(
 'teste-bebida-cancelamento','70000000-0000-0000-0000-000000000097',
 'Cliente Teste','21999999999','',
 '[{"product_id":"30000000-0000-0000-0000-000000000097","quantity":1,"options":[]},
   {"product_id":"30000000-0000-0000-0000-000000000098","quantity":2,"options":[]}]'::jsonb,
 'pickup','pix_manual','');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000097',true);
do $check$
declare v_order uuid;
begin
 select id into v_order from public.orders
  where request_id='70000000-0000-0000-0000-000000000097';
 assert v_order is not null,'Checkout deve existir';
 assert not exists(select 1 from public.pitacco_cancel_beverage_units where order_id=v_order),
  'Antes do preparo não existe devolução de bebida';
 assert (select balance=10 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000099'),
  'Pendente não consome bebida';
 perform public.accept_order(v_order);
 assert (select count(*)=1 from public.pitacco_cancel_beverage_units
  where order_id=v_order and product_id='30000000-0000-0000-0000-000000000098'
    and ordered_quantity=2),'Apenas refrigerante classificado no cadastro é retornável';
 assert not exists(select 1 from public.pitacco_cancel_beverage_units
  where order_id=v_order and product_id='30000000-0000-0000-0000-000000000097'),
  'Açaí não pode ser retornável';
 assert (select balance=8 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000099'),
  'Duas bebidas foram debitadas';
 assert (select balance=800 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000097'),
  'Açaí saiu do estoque';
 assert (select calculated_cost=11.50 from public.pitacco_order_material_cost_summary
  where order_id=v_order),'R$ 3 açaí + 0,50 copo + R$ 8 refrigerante';
 begin
  perform public.pitacco_confirm_sealed_beverage_return(
   '20000000-0000-0000-0000-000000000097',v_order,
   '30000000-0000-0000-0000-000000000098',1,
   '80000000-0000-0000-0000-000000000097',true,true);
  raise exception 'Proibido retornar antes do cancelamento';
 exception when sqlstate '22023' then null;
 end;
end $check$;

-- Simulação de evento real de cancelamento com permissões da rotina:
-- diretamente na fixture transacional, sem chamar API de marketplace.
reset role;
update public.orders set status='cancelled' where request_id='70000000-0000-0000-0000-000000000097';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000097',true);
do $check$
declare v_order uuid; result jsonb;
begin
 select id into v_order from public.orders where request_id='70000000-0000-0000-0000-000000000097';
 begin
  perform public.pitacco_confirm_sealed_beverage_return(
   '20000000-0000-0000-0000-000000000097',v_order,
   '30000000-0000-0000-0000-000000000098',1,
   '80000000-0000-0000-0000-000000000097',true,false);
  raise exception 'Bebida aberta não pode retornar';
 exception when sqlstate '22023' then null;
 end;
 begin
  perform public.pitacco_confirm_sealed_beverage_return(
   '20000000-0000-0000-0000-000000000097',v_order,
   '30000000-0000-0000-0000-000000000097',1,
   '80000000-0000-0000-0000-000000000097',true,true);
  raise exception 'Alimento não pode retornar';
 exception when sqlstate '22023' then null;
 end;
 result:=public.pitacco_confirm_sealed_beverage_return(
  '20000000-0000-0000-0000-000000000097',v_order,
  '30000000-0000-0000-0000-000000000098',1,
  '80000000-0000-0000-0000-000000000097',true,true);
 assert (result->>'already')::boolean=false,'Primeiro retorno aplicado';
 assert (select balance=9 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000099'),'Uma lata voltou fisicamente';
 assert (select balance=800 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000097'),'Nenhum açaí recuperado';
 assert (select count(*)=1 from public.pitacco_stock_movements
  where cancellation_beverage_return_id='80000000-0000-0000-0000-000000000097'
    and quantity=1 and order_id is null),'Livro de estoque registra devolução auditável';
 result:=public.pitacco_confirm_sealed_beverage_return(
  '20000000-0000-0000-0000-000000000097',v_order,
  '30000000-0000-0000-0000-000000000098',1,
  '80000000-0000-0000-0000-000000000097',true,true);
 assert (result->>'already')::boolean=true,'Retry não duplica estoque';
 assert (select balance=9 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000099'),'Saldo não duplicado';
 assert (select r.known_material_loss=7.50 and r.recovered_cost=4.00
  and r.complete_cost from public.pitacco_cancelled_order_loss_report(
   '20000000-0000-0000-0000-000000000097',current_date-1,current_date+1,0) r
  where r.order_id=v_order),'Perda parcial de materiais: 3,50 alimento + 4 bebida não retornada';
 begin
  perform public.pitacco_confirm_sealed_beverage_return(
   '20000000-0000-0000-0000-000000000097',v_order,
   '30000000-0000-0000-0000-000000000098',2,
   '80000000-0000-0000-0000-000000000098',true,true);
  raise exception 'Não pode devolver 3 unidades se vendeu 2';
 exception when sqlstate '22023' then null;
 end;
 perform public.pitacco_confirm_sealed_beverage_return(
  '20000000-0000-0000-0000-000000000097',v_order,
  '30000000-0000-0000-0000-000000000098',1,
  '80000000-0000-0000-0000-000000000098',true,true);
 assert (select balance=10 from public.pitacco_ingredients
  where id='40000000-0000-0000-0000-000000000099'),
  'Duas bebidas recuperadas integralmente';
 assert (select r.known_material_loss=3.50 and r.recovered_cost=8.00
  from public.pitacco_cancelled_order_loss_report(
   '20000000-0000-0000-0000-000000000097',current_date-1,current_date+1,0) r
  where r.order_id=v_order),'Perda final apenas do alimento';
 assert (select count(*)=2 from public.pitacco_cancel_beverage_returns where order_id=v_order);
end $check$;

-- Isolamento de lojistas e impossibilidade de inserir devolução por REST.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000098',true);
do $check$
declare v_order uuid;
begin
 select id into v_order from public.orders where request_id='70000000-0000-0000-0000-000000000097';
 assert not exists(select 1 from public.pitacco_cancel_beverage_returns),
  'Devoluções de outras lojas ocultas';
 begin
  perform public.pitacco_confirm_sealed_beverage_return(
   '20000000-0000-0000-0000-000000000097',v_order,
   '30000000-0000-0000-0000-000000000098',1,
   '80000000-0000-0000-0000-000000000099',true,true);
  raise exception 'Outra loja não pode devolver pedido';
 exception when insufficient_privilege then null;
 end;
end $check$;
rollback;