-- Run with psql ON_ERROR_STOP=1 against a disposable Supabase database after all migrations.
-- Entire fixture is rolled back. Never run against a database containing production users.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','dg-print-test-a@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','dg-print-test-b@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','dg-print-test-courier@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','DG Test A'),
 ('20000000-0000-0000-0000-000000000002','DG Test B');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into public.couriers(id,user_id,name,fleet_type,store_id,available) values('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','Courier teste','propria','20000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.print_sectors(store_id,sector,printer,width,copies) values
 ('20000000-0000-0000-0000-000000000001','cozinha','TEST-58',58,2);
select public.bind_print_device('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
do $$ declare oid uuid; repeated uuid; j record; begin
 oid := public.create_operational_order('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
 'Cliente ficticio','Rua de teste 1','[{"name":"Acai","quantity":2,"unit_price":20,"modifiers":["Granola"],"delivery_code":"SECRET"}]',40);
 assert (select status='pending' from public.orders where id=oid),'Order should be pending';
 assert not exists(select 1 from public.print_jobs where order_id=oid),'No print before acceptance';
 perform public.accept_order(oid);
 perform public.accept_order(oid);
 assert (select count(*)=2 from public.print_jobs where order_id=oid),'Duplicate accept must not duplicate copies';
 assert (select count(*)=1 from public.deliveries where order_id=oid),'Delivery created once';
 assert not exists(select 1 from public.print_jobs where order_id=oid and (receipt::text like '%SECRET%' or receipt_text like '%SECRET%')),'Secret field excluded';
 repeated := public.create_operational_order('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
 'Cliente ficticio','Rua de teste 1','[{"name":"Acai","quantity":2,"unit_price":20}]',40);
 assert repeated=oid,'Create retry idempotency';
 for j in select * from public.claim_print_jobs('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001') loop
  perform public.ack_print_job(j.id,j.device_id,'saved');
  perform public.ack_print_job(j.id,j.device_id,'uncertain','Interrupted after spool attempt');
  perform public.ack_print_job(j.id,j.device_id,'saved');
  assert (select state='uncertain' from public.print_jobs where id=j.id),'Ingest replay cannot reset uncertain job';
 end loop;
 perform public.reprint_order(oid,'50000000-0000-0000-0000-000000000001','Conferencia manual');
 perform public.reprint_order(oid,'50000000-0000-0000-0000-000000000001','Conferencia manual');
 assert (select count(*)=4 from public.print_jobs where order_id=oid),'Reprint request idempotency';
 begin
  perform public.bind_print_device('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002');
  raise exception 'TEST FAILURE: takeover allowed';
 exception when others then if SQLERRM like 'TEST FAILURE:%' then raise; end if; end;
 begin
  perform public.accept_order((select id from public.orders where id=oid)); -- authorized control
  perform public.create_operational_order('20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','Wrong','No','[{"name":"Acai","quantity":1,"unit_price":20}]',20);
  raise exception 'TEST FAILURE: cross tenant create allowed';
 exception when others then if SQLERRM like 'TEST FAILURE:%' then raise; end if; end;
 begin
  insert into public.orders(store_id,channel,gross,status) values('20000000-0000-0000-0000-000000000001','Delivery próprio',1,'accepted');
  raise exception 'TEST FAILURE: forged acceptance allowed';
 exception when insufficient_privilege then null; end;
end $$;
select public.set_dispatch_policy('20000000-0000-0000-0000-000000000001','automatico',1);
insert into public.acceptance_settings values('20000000-0000-0000-0000-000000000001','proprio','automatic',true);
do $$ declare oid uuid; begin
 oid := public.create_operational_order('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','Auto','Rua 2','[{"name":"Acai","quantity":1,"unit_price":20}]',20);
 assert (select status='accepted' from public.orders where id=oid),'Automatic own-order accept';
 assert (select count(*)=2 from public.print_jobs where order_id=oid),'Automatic own-order jobs';
 assert (select status='atribuida' and courier_id='70000000-0000-0000-0000-000000000001'::uuid from public.deliveries where order_id=oid),'Auto dispatch to available courier';
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 assert (select count(*)=0 from public.print_jobs),'RLS job isolation';
 assert (select count(*)=0 from public.operation_audit),'RLS audit isolation';
 assert (select count(*)=0 from public.orders where store_id='20000000-0000-0000-0000-000000000001'),'RLS orders isolation';
 begin
  perform public.claim_print_jobs('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
  raise exception 'TEST FAILURE: cross tenant claim allowed';
 exception when others then if SQLERRM like 'TEST FAILURE:%' then raise; end if; end;
end $$;
reset role;
insert into public.orders(id,store_id,channel,gross,status,source) values('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','iFood',20,'pending','ifood');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
 begin
  perform public.accept_order('60000000-0000-0000-0000-000000000001');
  raise exception 'TEST FAILURE: marketplace accepted without official response';
 exception when others then if SQLERRM like 'TEST FAILURE:%' then raise; end if; end;
 assert (select status='pending' from public.orders where id='60000000-0000-0000-0000-000000000001'),'Marketplace remains pending';
 assert not exists(select 1 from public.print_jobs where order_id='60000000-0000-0000-0000-000000000001'),'Marketplace cannot print';
end $$;
rollback;
