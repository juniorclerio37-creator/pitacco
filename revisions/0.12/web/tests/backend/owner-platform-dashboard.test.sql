begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','dashboard-owner@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','dashboard-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','dashboard-store-driver@example.invalid'),
 ('10000000-0000-0000-0000-000000000004','dashboard-shared-driver@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash)
values ('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Açaí Alpha'),
 ('20000000-0000-0000-0000-000000000002','Loja Beta');
insert into public.stores(name) select 'Loja extra '||id from generate_series(1,15) as id;
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
insert into public.couriers(user_id,name,store_id,active,fleet_type) values
 ('10000000-0000-0000-0000-000000000003','Entregador da loja','20000000-0000-0000-0000-000000000001',true,'propria'),
 ('10000000-0000-0000-0000-000000000004','Entregador compartilhado',null,false,'compartilhada');
insert into public.orders(id,store_id,channel,gross,status,source,preparation_status,scheduled_for,scheduled_release_at,receipt) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Delivery próprio',30,'pending','proprio','preparing',null,null,null),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Delivery próprio',40,'historical','proprio','preparing',null,null,null),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','iFood',40,'accepted','ifood','ready',null,null,'{"ifood_status":"DISPATCHED"}'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','Delivery próprio',40,'accepted','proprio','completed',null,null,null),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','Delivery próprio',50,'pending','proprio','preparing',now()+interval '1 day',now()+interval '23 hours',null),
 ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','Delivery próprio',50,'accepted','proprio','ready',null,null,null);
update public.orders set created_at=now()-interval '1 day' where id='30000000-0000-0000-0000-000000000003';
insert into public.deliveries(store_id,order_id,customer_name,address,status)
values ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000006','Nome interno','Endereço interno','entregue');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin
  perform public.pitacco_owner_platform_dashboard('',0);
  raise exception 'O gestor não deve ler os dados globais';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$
declare result jsonb;
begin
 result:=public.pitacco_owner_platform_dashboard('ALPHA',0);
 assert result#>>'{billing,registered}'='17';
 assert result->>'orders_today'='4';
 assert result#>>'{orders,in_progress}'='2';
 assert result#>>'{orders,pending}'='1';
 assert result#>>'{orders,delivering}'='1';
 assert result#>>'{orders,scheduled}'='1';
 assert result#>>'{channels,proprio}'='4';
 assert result#>>'{couriers,registered}'='2';
 assert result#>>'{couriers,active}'='1';
 assert result#>>'{couriers,shared}'='1';
 assert result->>'deliveries_in_progress'='0';
 assert result->>'matching_stores'='1';
 assert result#>>'{stores,0,name}'='Açaí Alpha';
 assert result#>>'{stores,0,orders_today}'='3';
 assert result#>>'{stores,0,couriers}'='1';
 assert result::text not like '%Nome interno%';
 assert jsonb_array_length(public.pitacco_owner_platform_dashboard('',0)->'stores')=15;
 assert jsonb_array_length(public.pitacco_owner_platform_dashboard('',1)->'stores')=2;
 assert not has_function_privilege('anon','public.pitacco_owner_platform_dashboard(text,integer)','execute');
end $$;
rollback;
