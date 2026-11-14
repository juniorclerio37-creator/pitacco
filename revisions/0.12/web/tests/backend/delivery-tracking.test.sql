begin;
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','tracking-courier@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000001','Tracking Store');
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available)
 values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Courier','propria','20000000-0000-0000-0000-000000000001',true,true);
insert into public.orders(id,store_id,channel,gross,source,status) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','accepted'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','accepted');
insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,tracking_token) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','{"fulfillment":"delivery"}','21999999999','60000000-0000-0000-0000-000000000001');
insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,logistics_provider,collected_at) values
 ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Cliente','Private Address','atribuida','loja',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.courier_heartbeat(-22.851234,-43.452894,30);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
begin
 assert public.pitacco_track_public_order('60000000-0000-0000-0000-000000000002') is null;
 assert public.pitacco_track_public_order('60000000-0000-0000-0000-000000000001')->>'courier_position' is null, 'No GPS before dispatch';
end;
$test$;
reset role;
update public.deliveries set status='retirada',collected_at=now() where id='70000000-0000-0000-0000-000000000001';
set local role anon;
do $test$
declare
 tracking jsonb := public.pitacco_track_public_order('60000000-0000-0000-0000-000000000001');
 position_data jsonb := tracking->'courier_position';
begin
 assert position_data->>'state'='available';
 assert (position_data->>'latitude')::numeric=-22.851 and (position_data->>'longitude')::numeric=-43.453;
 assert not tracking ? 'address' and not position_data ? 'courier_id', 'Only approximate client-facing coordinates';
end;
$test$;
reset role;
insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,status,logistics_provider,collected_at) values
 ('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Outro','Another Private Address','retirada','loja',now());
set local role anon;
do $test$
begin
 assert public.pitacco_track_public_order('60000000-0000-0000-0000-000000000001')->'courier_position'='{"state":"multiple_stops"}';
end;
$test$;
reset role;
update public.deliveries set status='entregue' where id='70000000-0000-0000-0000-000000000002';
update public.courier_positions set observed_at=now()-interval '2 minutes';
set local role anon;
do $test$
begin
 assert public.pitacco_track_public_order('60000000-0000-0000-0000-000000000001')->'courier_position'='{"state":"awaiting_gps"}';
end;
$test$;
reset role;
update public.courier_positions set observed_at=now();
update public.deliveries set status='entregue' where id='70000000-0000-0000-0000-000000000001';
set local role anon;
do $test$
begin
 assert public.pitacco_track_public_order('60000000-0000-0000-0000-000000000001')->>'courier_position' is null, 'Completed delivery stops sharing coordinates';
end;
$test$;
rollback;
