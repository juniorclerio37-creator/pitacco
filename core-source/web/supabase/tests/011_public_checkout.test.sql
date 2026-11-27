begin;
insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','checkout@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000001','Checkout Test');
insert into public.store_members values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings('20000000-0000-0000-0000-000000000001','teste',true,true,true,5,array['dinheiro','pix_manual'],'Confira com a loja');
select public.save_menu_product('20000000-0000-0000-0000-000000000001',null,'Lanche',20,'Lanches','','',true);
insert into public.print_sectors(store_id,sector,printer,width,copies) values ('20000000-0000-0000-0000-000000000001','cozinha','TEST',58,1);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare menu jsonb; items jsonb; r jsonb; again jsonb; begin
 menu:=public.get_public_menu('teste');
 assert not (menu->'products'->0 ? 'cost'),'No public cost';
 items:=jsonb_build_array(jsonb_build_object('product_id',menu->'products'->0->>'id','quantity',2));
 r:=public.checkout_public_order('teste','40000000-0000-0000-0000-000000000001','Cliente','11999999999','Rua teste 123',items,'delivery','pix_manual');
 assert (r->>'total')::numeric=45,'Server price plus delivery';
 assert r->>'status'='pending','Manual acceptance';
 assert r->>'payment_status'='pending','Pix not automatically paid';
 again:=public.checkout_public_order('teste','40000000-0000-0000-0000-000000000001','Cliente','11999999999','Rua teste 123',items,'delivery','pix_manual');
 assert r=again,'Idempotent checkout';
 assert not(public.track_public_order((r->>'tracking_token')::uuid) ? 'phone'),'No tracking PII';
 begin
 perform public.checkout_public_order('teste','40000000-0000-0000-0000-000000000001','Outro','11999999999','Rua teste 123',items,'delivery','pix_manual');
 raise exception 'TEST FAILURE reused key';
 exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 begin
 perform public.checkout_public_order('teste',gen_random_uuid(),'Cliente','11999999999','Rua teste 123',jsonb_build_array((items->0)||'{"price":0}'::jsonb),'delivery','dinheiro');
 raise exception 'TEST FAILURE price injection';
 exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 begin
 perform count(*) from public.orders;
 raise exception 'TEST FAILURE public orders read';
 exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare oid uuid;begin
 select id into oid from public.orders where request_id='40000000-0000-0000-0000-000000000001';
 assert not exists(select 1 from public.print_jobs where order_id=oid),'No print before accept';
 perform public.accept_order(oid);perform public.accept_order(oid);
 assert (select count(*)=1 from public.print_jobs where order_id=oid),'One job after repeated accept';
 assert (select delivery_fee=5 from public.deliveries where order_id=oid),'Delivery fee carried';
 perform public.confirm_manual_payment(oid,'50000000-0000-0000-0000-000000000001',45,'Conferido teste');
 perform public.confirm_manual_payment(oid,'50000000-0000-0000-0000-000000000001',45,'Conferido teste');
 assert (select count(*)=1 from public.manual_payments where order_id=oid),'One manual payment';
end $$;
rollback;
