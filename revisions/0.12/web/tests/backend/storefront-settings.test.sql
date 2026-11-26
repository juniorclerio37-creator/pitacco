begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','storefront-owner@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','storefront-staff@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Açaí do Linho'),
 ('20000000-0000-0000-0000-000000000002','Açaí do Linho'),
 ('20000000-0000-0000-0000-000000000003','Termos');
-- Setup the only source of the shop origin: its saved map marker.
update public.stores set address='Rua da Loja',city='Nova Iguaçu',state='RJ'
 where id='20000000-0000-0000-0000-000000000001';
update public.stores set latitude=-22.7,longitude=-43.4
 where id='20000000-0000-0000-0000-000000000001';
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
select public.pitacco_save_channel_payments('20000000-0000-0000-0000-000000000001','acaidolinho',true,true,true,array['dinheiro','cartao_credito','voucher_alelo'],array['dinheiro','pix_maquininha','voucher_ticket'],'');
do $
begin
 assert (select pdv_payment_methods=array['dinheiro','pix_maquininha','voucher_ticket'] from public.public_menu_settings where store_id='20000000-0000-0000-0000-000000000001');
 assert public.get_public_menu('acaidolinho')->'store'->'payment_methods'='["dinheiro","cartao_credito","voucher_alelo"]'::jsonb;
end $;
-- A real circle definition, configured in Área de Entrega, replaces the
-- old delivery_fee=5 setting that still exists for schema compatibility.
select public.pitacco_save_delivery_zone('20000000-0000-0000-0000-000000000001',
 'circle',3,'[5,5,5,0,0,0,0,0,0,0]'::jsonb,'[]'::jsonb,0);
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
-- The Edge Function uses service_role; authenticated merchant cannot insert quotes.
reset role;
-- Only the server/service role may write a quote. Reset test privileges
-- before creating this server-side fixture, then act as anon for checkout.
reset role;
-- A quote is generated server-side, only inside a configured area.
insert into public.pitacco_delivery_route_quotes
 (id,store_id,request_id,destination_address,distance_m,fee,
  pricing_updated_at,expires_at,destination_latitude,destination_longitude)
select '60000000-0000-0000-0000-000000000020',
 store_id,'60000000-0000-0000-0000-000000000021','Rua Teste, 100',
 1100,5,updated_at,now()+interval '5 minutes',-22.71,-43.4
from public.pitacco_delivery_pricing
where store_id='20000000-0000-0000-0000-000000000001';
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare
 items jsonb := '[{"product_id":"30000000-0000-0000-0000-000000000001","quantity":1}]';
 req uuid := '60000000-0000-0000-0000-000000000021';
 result jsonb;
begin
 assert public.get_public_menu('acaidolinho')->'store'->'delivery_area'->>'radius_m'='3000';
 assert public.get_public_menu('acaidolinho')->'store'->>'delivery_fee'='0';
 begin
  perform public.checkout_public_order('acaidolinho',gen_random_uuid(),'Cliente','21999999999','',items,'pickup','pix_maquininha','');
  raise exception 'Expected PDV-only Pix rejection';
 exception when raise_exception then
  if sqlerrm<>'Modalidade indisponivel' then raise;end if;
 end;
 assert (public.checkout_public_order('acaidolinho',gen_random_uuid(),'Cliente','21999999999','',items,'pickup','voucher_alelo','')->>'total')::numeric=25;
 begin
  perform public.checkout_public_order('acaidolinho',req,'Cliente','21999999999',
   'Rua Teste, 100',items,'delivery','dinheiro','');
  raise exception 'Expected missing quote rejection';
 exception when raise_exception then
  if sqlerrm not like 'Calcule o frete%' then raise; end if;
 end;
 -- A legacy client pin alone must never bypass the area pricing quote.
 begin
  perform public.pitacco_checkout_geocoded_order('acaidolinho',req,'Cliente','21999999999',
   'Rua Teste, 100',items,'delivery','dinheiro','',-22.71,-43.4);
  raise exception 'Expected legacy checkout rejection';
 exception when raise_exception then
  if sqlerrm not like 'Calcule o frete%' then raise; end if;
 end;
 result := public.pitacco_checkout_quoted_delivery('acaidolinho',req,'Cliente',
  '21999999999','Rua Teste, 100',items,'delivery','dinheiro','',
  '60000000-0000-0000-0000-000000000020');
 assert (result->>'total')::numeric=30, 'Only area quote fee 5 is charged';
 assert result=public.pitacco_checkout_quoted_delivery('acaidolinho',req,'Cliente',
  '21999999999','Rua Teste, 100',items,'delivery','dinheiro','',
  '60000000-0000-0000-0000-000000000020');
 assert (public.checkout_public_order('acaidolinho',gen_random_uuid(),'Cliente',
  '21999999999','',items,'pickup','dinheiro','')->>'total')::numeric=25;
end $;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $
declare result jsonb; req uuid:=gen_random_uuid();
begin
 result:=public.pitacco_merchant_channel_checkout('20000000-0000-0000-0000-000000000001',req,'balcao','Cliente','21999999999','',
 '[{"product_id":"30000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,'pix_maquininha','','',null,null,25);
 assert result->>'payment_status'='paid_manual';
 assert (select receipt->>'payment'='pix_maquininha' and receipt->>'payment_status'='paid' from public.orders where request_id=req);
end $;
rollback;
