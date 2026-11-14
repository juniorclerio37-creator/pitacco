begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','schedule-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','schedule-other@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Schedule Store'),
 ('20000000-0000-0000-0000-000000000002','Other Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values ('20000000-0000-0000-0000-000000000001','test-schedule',true,false,true,0,array['pix_manual'],'');
insert into public.products(id,store_id,name,price,cost,menu_active)
 values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Açaí',20,5,true);
insert into public.acceptance_settings(store_id,source,mode,enabled)
 values ('20000000-0000-0000-0000-000000000001','proprio','automatic',true);
insert into public.loyalty_coupons(store_id,code,discount_type,discount_value)
 values ('20000000-0000-0000-0000-000000000001','AGENDADO','fixed',5);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.pitacco_schedule_windows(store_id,weekday,enabled,opens_minute,closes_minute)
 select '20000000-0000-0000-0000-000000000001',day,true,0,1440 from generate_series(1,7) day;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
 assert not exists (select 1 from public.pitacco_schedule_windows), 'Hours of a different store are inaccessible';
end;
$test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare
 slots timestamptz[] := public.pitacco_public_schedule_slots('test-schedule','pickup');
 checkout jsonb;
 coupon jsonb;
 request_id uuid := '40000000-0000-0000-0000-000000000001';
 items jsonb := '[{"product_id":"30000000-0000-0000-0000-000000000001","quantity":2}]';
begin
 assert cardinality(slots)>0 and slots[1]>=now()+interval '60 minutes', 'Only future slots with enough lead time are offered';
 assert extract(minute from slots[1] at time zone 'America/Sao_Paulo') in (0,30), 'Uses half-hour slots';
 assert cardinality(public.pitacco_public_schedule_slots('test-schedule','delivery'))=0, 'Disabled delivery has no scheduled times';
 assert cardinality(public.pitacco_public_schedule_slots('other-store','pickup'))=0, 'No slots without a public menu';
 checkout:=public.pitacco_checkout_scheduled_order('test-schedule',request_id,'Cliente','21999999999','',items,'pickup','pix_manual','',slots[1]);
 assert checkout->>'status'='pending' and checkout->>'payment_status'='pending', 'A scheduled order bypasses the automatic accept setting and still requires payment confirmation';
 assert ((public.pitacco_track_public_order((checkout->>'tracking_token')::uuid))->>'scheduled_for')::timestamptz=slots[1], 'Only the private tracking token returns the appointment';
 assert public.pitacco_checkout_scheduled_order('test-schedule',request_id,'Cliente','21999999999','',items,'pickup','pix_manual','',slots[1])=checkout, 'Retries produce the original receipt';
 begin
  perform public.pitacco_checkout_scheduled_order('test-schedule',request_id,'Cliente','21999999999','',items,'pickup','pix_manual','',slots[2]);
  raise exception 'Expected reused key rejection';
 exception when raise_exception then
  if sqlerrm <> 'Chave reutilizada com dados diferentes' then raise; end if;
 end;
 begin
  perform public.pitacco_checkout_scheduled_order('test-schedule',gen_random_uuid(),'Cliente','21999999999','',items,'pickup','pix_manual','',slots[1]+interval '1 minute');
  raise exception 'Expected invalid slot rejection';
 exception when raise_exception then
  if sqlerrm <> 'Horário de agendamento indisponível' then raise; end if;
 end;
 coupon:=public.pitacco_checkout_scheduled_order_coupon('test-schedule',gen_random_uuid(),'Cliente','21999999999','',items,'pickup','pix_manual','','AGENDADO',slots[2]);
 assert (coupon->>'total')::numeric=35 and (coupon->>'status')='pending', 'Scheduled coupon checkout preserves server pricing and state';
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare selected_order uuid;
begin
 select id into selected_order from public.orders where request_id='40000000-0000-0000-0000-000000000001';
 begin
  perform public.accept_order(selected_order);
  raise exception 'Expected preparation time restriction';
 exception when raise_exception then
  if sqlerrm <> 'Pedido agendado ainda não foi liberado para preparo' then raise; end if;
 end;
end;
$test$;
reset role;
update public.orders set scheduled_release_at=now()-interval '1 minute' where request_id='40000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare selected_order uuid;
begin
 select id into selected_order from public.orders where request_id='40000000-0000-0000-0000-000000000001';
 perform public.accept_order(selected_order);
 assert (select status='accepted' from public.orders where id=selected_order), 'The normal order pipeline starts after release';
end;
$test$;
rollback;
