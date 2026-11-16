
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','commercial-owner@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','commercial-manager@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash)
values ('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Faixa mensal'),
 ('20000000-0000-0000-0000-000000000002','Outra loja');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
insert into public.orders(id,store_id,channel,gross,status,source,preparation_status,created_at,receipt) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Delivery próprio',1000,'accepted','proprio','completed','2026-10-01 03:00+00',null),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','iFood',500,'accepted','ifood','completed','2026-10-02 10:00+00',null),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','99Food',300,'accepted','99food','completed','2026-10-03 10:00+00',null),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','Delivery próprio',200,'accepted','keeta','ready','2026-11-01 02:59:59+00',null),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','Delivery próprio',500,'cancelled','proprio','completed','2026-10-04 10:00+00',null),
 ('30000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001','iFood',500,'pending','ifood','ready','2026-10-04 10:00+00',null),
 ('30000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000001','Delivery próprio',500,'accepted','proprio','completed','2026-10-04 10:00+00','{"is_test":true}'),
 ('30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001','Delivery próprio',500,'accepted','proprio','completed','2026-11-01 03:00+00',null),
 ('30000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000002','iFood',3000,'accepted','ifood','completed','2026-10-04 10:00+00',null),
 ('30000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001','Delivery próprio',0.01,'accepted','proprio','ready','2026-10-04 10:00+00',null),
 ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001','Delivery próprio',500,'accepted','proprio','completed','2026-10-04 10:00+00',null),
 ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001','iFood',500,'accepted','ifood','completed','2026-10-05 10:00+00','{"ifood_status":"CONCLUDED","ifood_test":true}');
insert into public.deliveries(order_id,store_id,customer_name,address,status) values
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','Fixture','Fixture','entregue'),
 ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001','Fixture','Fixture','cancelada');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin
  perform public.pitacco_owner_monthly_plan_estimate('20000000-0000-0000-0000-000000000001','2026-10-01');
  raise exception 'Funcionário não deve consultar a apuração administrativa';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$
declare
 plans jsonb:=public.pitacco_owner_commercial_plans();
 result jsonb;
begin
 assert jsonb_array_length(plans)=1;
 assert plans#>>'{0,commission_basis_points}'='0';
 assert plans#>>'{0,sales_threshold_cents}'='200000';
 assert plans#>>'{0,trial_days}'='30';
 assert not has_function_privilege('anon','public.pitacco_owner_monthly_plan_estimate(uuid,date)','execute');
 result:=public.pitacco_owner_monthly_plan_estimate('20000000-0000-0000-0000-000000000001','2026-10-01');
 assert result->>'sales_cents'='200000' and result->>'monthly_cents'='3990';
 assert jsonb_array_length(result->'channels')=4;
 result:=public.pitacco_owner_monthly_plan_estimate('20000000-0000-0000-0000-000000000001','2026-09-01');
 assert result->>'sales_cents'='0' and result->>'monthly_cents'='3990';
end $$;

reset role;
update public.orders set preparation_status='completed' where id='30000000-0000-0000-0000-000000000010';
set local role authenticated;
do $$
declare result jsonb;
begin
 result:=public.pitacco_owner_monthly_plan_estimate('20000000-0000-0000-0000-000000000001','2026-10-01');
 assert result->>'sales_cents'='200001' and result->>'monthly_cents'='5990';
end $$;
rollback;
