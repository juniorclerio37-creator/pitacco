begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','storefront-owner@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','storefront-staff@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Açaí do Linho'),
 ('20000000-0000-0000-0000-000000000002','Açaí do Linho'),
 ('20000000-0000-0000-0000-000000000003','Termos');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','lojista');
do $$
begin
 assert (select slug='acaidolinho' and not enabled from public.public_menu_settings where store_id='20000000-0000-0000-0000-000000000001');
 assert (select slug like 'acaidolinho-%' from public.public_menu_settings where store_id='20000000-0000-0000-0000-000000000002');
 assert (select slug like 'loja-%' from public.public_menu_settings where store_id='20000000-0000-0000-0000-000000000003');
end $$;
insert into public.products(id,store_id,name,price,cost,menu_active)
values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Açaí',25,5,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings('20000000-0000-0000-0000-000000000001','acaidolinho',true,true,true,5,array['dinheiro'],'');
insert into public.pitacco_store_delivery_areas values ('20000000-0000-0000-0000-000000000001',-22.7,-43.4,3000,true);
insert into public.pitacco_store_payment_providers values ('20000000-0000-0000-0000-000000000001','mercado_pago',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$
begin
 assert public.pitacco_storefront_link('20000000-0000-0000-0000-000000000001')->>'slug'='acaidolinho';
 assert public.pitacco_storefront_link('20000000-0000-0000-0000-000000000003') is null;
 assert not exists(select 1 from public.pitacco_store_delivery_areas);
 assert not exists(select 1 from public.pitacco_store_payment_providers);
 begin
  insert into public.pitacco_store_payment_providers values ('20000000-0000-0000-0000-000000000001','pagbank',true);
  raise exception 'Expected tenant-level provider isolation';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.pitacco_admin_record_homologation('20000000-0000-0000-0000-000000000001','mercado_pago','approved','Teste alheio',gen_random_uuid());
  raise exception 'Expected owner-only homologation';
 exception when raise_exception then
  if sqlerrm <> 'Acesso exclusivo da administração do Pitacco' then raise; end if;
 end;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare
  items jsonb := '[{"product_id":"30000000-0000-0000-0000-000000000001","quantity":1}]';
  req uuid := gen_random_uuid();
  result jsonb;
begin
 assert public.get_public_menu('acaidolinho')->'store'->'delivery_area'->>'radius_m'='3000';
 begin
  perform public.checkout_public_order('acaidolinho',req,'Cliente','21999999999','Rua Teste, 100',items,'delivery','dinheiro','');
  raise exception 'Expected missing pin rejection';
 exception when raise_exception then
  if sqlerrm <> 'Marque o endereço de entrega no mapa' then raise; end if;
 end;
 begin
  perform public.pitacco_checkout_geocoded_order('acaidolinho',req,'Cliente','21999999999','Rua Teste, 100',items,'delivery','dinheiro','',-22.8,-43.4);
  raise exception 'Expected out of area rejection';
 exception when raise_exception then
  if sqlerrm <> 'Este endereço está fora da área de entrega da loja' then raise; end if;
 end;
 result := public.pitacco_checkout_geocoded_order('acaidolinho',req,'Cliente','21999999999','Rua Teste, 100',items,'delivery','dinheiro','',-22.71,-43.4);
 assert (result->>'total')::numeric=30;
 assert result=public.pitacco_checkout_geocoded_order('acaidolinho',req,'Cliente','21999999999','Rua Teste, 100',items,'delivery','dinheiro','',-22.71,-43.4);
 assert (public.checkout_public_order('acaidolinho',gen_random_uuid(),'Cliente','21999999999','',items,'pickup','dinheiro','')->>'total')::numeric=25;
end $$;
rollback;
