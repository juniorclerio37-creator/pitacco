begin;
alter table public.stores add column if not exists address text;
alter table public.stores add column if not exists city text;
alter table public.stores add column if not exists state text;
insert into auth.users(id,email) values ('90000000-0000-0000-0000-000000000001','delivery-rates@example.invalid');
insert into public.stores(id,name,address,city,state) values
 ('90000000-0000-0000-0000-000000000002','Loja de Teste','Rua Central','Nova Iguacu','RJ');
insert into public.store_members values
 ('90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','gestor');
insert into public.products(id,store_id,name,price,cost,menu_active)
values('90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','Açaí',25,8,true);

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings('90000000-0000-0000-0000-000000000002','lojarotas',true,true,true,0,array['dinheiro'],'');
select public.pitacco_save_delivery_pricing('90000000-0000-0000-0000-000000000002',5,'[2,4,6,8,10,12,14,16,18,20]'::jsonb,
 '[{"bairro":"Centro","cidade":"Nova Iguacu","taxa":7.50}]'::jsonb);
do $$ begin
 assert (select not enabled and max_radius_km=5 from public.pitacco_delivery_pricing
  where store_id='90000000-0000-0000-0000-000000000002');
 assert (public.pitacco_store_readiness('90000000-0000-0000-0000-000000000002')->'checks'->>'products')='true';
end $$;

reset role;
update public.pitacco_delivery_pricing set enabled=true
 where store_id='90000000-0000-0000-0000-000000000002';

insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at)
select '90000000-0000-0000-0000-000000000005',
 store_id,'90000000-0000-0000-0000-000000000004','Rua Teste 100',3200,7.50,updated_at,now()+interval '5 minutes'
from public.pitacco_delivery_pricing where store_id='90000000-0000-0000-0000-000000000002';

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare items jsonb:='[{"product_id":"90000000-0000-0000-0000-000000000003","quantity":1}]'::jsonb;
 result jsonb;
begin
 begin
  perform public.checkout_public_order('lojarotas','90000000-0000-0000-0000-000000000004',
   'Cliente','21999999999','Rua Teste 100',items,'delivery','dinheiro','');
  raise exception 'Pedido sem cotação deveria ser recusado';
 exception when raise_exception then
  if sqlerrm not like 'Calcule o frete%' then raise;end if;
 end;
 result:=public.pitacco_checkout_quoted_delivery('lojarotas','90000000-0000-0000-0000-000000000004',
   'Cliente','21999999999','Rua Teste 100',items,'delivery','dinheiro','','90000000-0000-0000-0000-000000000005');
 assert (result->>'total')::numeric=32.50;
 assert result=public.pitacco_checkout_quoted_delivery('lojarotas','90000000-0000-0000-0000-000000000004',
   'Cliente','21999999999','Rua Teste 100',items,'delivery','dinheiro','','90000000-0000-0000-0000-000000000005');
end $$;
rollback;
