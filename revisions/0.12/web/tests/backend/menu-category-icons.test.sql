begin;
insert into auth.users(id,email) values
 ('a1000000-0000-0000-0000-000000000001','icons-manager-a@example.invalid'),
 ('a1000000-0000-0000-0000-000000000002','icons-manager-b@example.invalid');
insert into public.stores(id,name) values
 ('a2000000-0000-0000-0000-000000000001','Ícones Loja A'),
 ('a2000000-0000-0000-0000-000000000002','Ícones Loja B');
insert into public.store_members values
 ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','gestor'),
 ('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods)
values ('a2000000-0000-0000-0000-000000000001','icons-test-menu',true,false,true,0,array['dinheiro']::text[]);
insert into public.products(id,store_id,name,price,cost,menu_active,category) values
 ('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Combo marmita e bebida',29.9,10,true,'Combos'),
 ('a3000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','Pizza fatia',12,4,true,'Pizzas');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
do $test$
declare r jsonb; data jsonb;
begin
 r:=public.pitacco_menu_category_icons_state('a2000000-0000-0000-0000-000000000001');
 assert r='{}'::jsonb, 'Nova loja começa sem escolhas';
 r:=public.pitacco_menu_category_set_icon('a2000000-0000-0000-0000-000000000001','Combos','combo-meal');
 assert r->>'saved'='true', 'Escolha persistida';
 r:=public.pitacco_menu_category_set_icon('a2000000-0000-0000-0000-000000000001','Pizzas','pizza-slice');
 assert r->>'icon'='pizza-slice', 'Ícone da pizza precisa ser permitido';
 data:=public.get_public_menu('icons-test-menu');
 assert data->'store'->'category_icons'->>'Combos'='combo-meal', 'Ícone do combo enviado para o cliente';
 assert data->'store'->'category_icons'->>'Pizzas'='pizza-slice', 'Ícone SVG de pizza enviado ao cliente';
 begin
  perform public.pitacco_menu_category_set_icon('a2000000-0000-0000-0000-000000000001','Combos','<svg onload=alert(1)>');
  raise exception 'Ícone não confiável foi aceito';
 exception when raise_exception then
  if sqlerrm <> 'Ícone não permitido' then raise; end if;
 end;
 begin
  perform public.pitacco_menu_category_set_icon('a2000000-0000-0000-0000-000000000001','Inexistente','flame');
  raise exception 'Categoria inexistente foi aceita';
 exception when raise_exception then
  if sqlerrm <> 'Categoria não encontrada nesta loja' then raise; end if;
 end;
end $test$;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
do $test$
begin
 begin
  perform public.pitacco_menu_category_set_icon('a2000000-0000-0000-0000-000000000001','Combos','combo-burger');
  raise exception 'Gestor de outra loja conseguiu mudar ícone';
 exception when insufficient_privilege then null;end;
end $test$;
reset role;
do $test$
begin
 assert not has_function_privilege('anon','public.pitacco_menu_category_set_icon(uuid,text,text)','execute');
 assert not has_function_privilege('anon','public.pitacco_menu_category_icons_state(uuid)','execute');
 assert has_function_privilege('authenticated','public.pitacco_menu_category_set_icon(uuid,text,text)','execute');
end $test$;
rollback;
