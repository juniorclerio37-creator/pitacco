begin;
insert into auth.users(id,email) values('91000000-0000-0000-0000-000000000001','checkout-priority@example.invalid');
insert into public.stores(id,name,dispatch_mode,latitude,longitude,address,city,state) values('91000000-0000-0000-0000-000000000002','Checkout priority fixture','manual',-22.91,-43.46,'Rua Fixture','Nova Iguaçu','RJ');
insert into public.store_members values('91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','gestor');
insert into public.products(id,store_id,name,price,cost,menu_active) values('91000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000002','Fixture',25,8,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings('91000000-0000-0000-0000-000000000002','priority-recovery-fixture',true,true,true,0,array['pix_manual','dinheiro'],'Chave Pix fixture');
select public.pitacco_store_hours_save_v2('91000000-0000-0000-0000-000000000002',
 (select jsonb_agg(jsonb_build_object('weekday',day,'slot',1,'opens_minute',0,'closes_minute',1440)) from generate_series(1,7) day),false,0,true);
select public.pitacco_save_delivery_zone_times('91000000-0000-0000-0000-000000000002',1,'[5,5,5,5,5,5,5,5,5,5]',
 (select jsonb_agg('{"min_minutes":40,"max_minutes":60,"priority":{"enabled":true,"fee":9,"min_minutes":20,"max_minutes":30}}'::jsonb) from generate_series(1,10)));
reset role;
insert into public.acceptance_settings(store_id,source,mode,enabled) values('91000000-0000-0000-0000-000000000002','proprio','automatic',true);
insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,delivery_min_minutes,delivery_max_minutes,delivery_region,delivery_service)
select ('91000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,store_id,
 ('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Rua Fixture 123',500,case when n=13 then 5 else 9 end,updated_at,now()+interval '5 minutes',-22.91,-43.46,
 case when n=13 then 40 else 20 end,case when n=13 then 60 else 30 end,'Centro',case when n=13 then 'standard' else 'priority' end
from public.pitacco_delivery_pricing cross join generate_series(11,13) n where store_id='91000000-0000-0000-0000-000000000002';
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare items jsonb:='[{"product_id":"91000000-0000-0000-0000-000000000003","quantity":1,"options":[]}]'; result jsonb; replay jsonb; slot timestamptz;
begin
 result:=public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000011','Cliente','21999999999','Rua Fixture 123',items,'delivery','pix_manual','Complemento preservado','91000000-0000-0000-0000-000000000011');
 assert (result->>'total')::numeric=34,'Priority quote charges its own fee';
 assert result->>'status'='accepted','Anonymous quoted delivery honors automatic acceptance';
 assert not has_function_privilege('anon','pitacco_private.accept_own_from_checkout(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','pitacco_private.accept_own_from_checkout(uuid,uuid)','EXECUTE');
 replay:=public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000011','Cliente','21999999999','Rua Fixture 123',items,'delivery','pix_manual','Complemento preservado','91000000-0000-0000-0000-000000000011');
 assert replay=result,'Lost response returns original receipt';
 assert public.pitacco_public_checkout_recovery('priority-recovery-fixture','92000000-0000-0000-0000-000000000011')->>'order_id'=result->>'order_id';
 assert public.pitacco_public_checkout_recovery('different-store','92000000-0000-0000-0000-000000000011')='{"confirmed":false}'::jsonb;
 assert public.pitacco_track_public_order((result->>'tracking_token')::uuid)->>'delivery_service'='priority','Tracking preserves priority';
 perform set_config('test.priority.result',result::text,true);
 slot:=(public.pitacco_public_schedule_slots('priority-recovery-fixture','delivery'))[1];
 begin
  perform public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000012','Cliente','21999999999','Rua Fixture 123',items,'delivery','pix_manual','','91000000-0000-0000-0000-000000000012',slot);
  raise exception 'TEST FAILURE: scheduled priority accepted';
 exception when raise_exception then
  if sqlerrm not like 'Entrega prioritária disponível apenas para pedidos imediatos%' then raise;end if;
 end;
 result:=public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000013','Cliente','21999999999','Rua Fixture 123',items,'delivery','dinheiro','Troco para: R$ 100','91000000-0000-0000-0000-000000000013',slot);
 assert result->>'status'='pending','Scheduled standard delivery requires manual acceptance even with auto accept enabled';
 assert (result->>'total')::numeric=30;
 assert result=public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000013','Cliente','21999999999','Rua Fixture 123',items,'delivery','dinheiro','Troco para: R$ 100','91000000-0000-0000-0000-000000000013',slot);
end $test$;
reset role;
do $test$
declare o public.orders%rowtype; d public.deliveries%rowtype;
begin
 select * into strict o from public.orders where request_id='92000000-0000-0000-0000-000000000011';
 assert o.receipt->>'delivery_service'='priority' and (o.receipt#>>'{delivery_eta,max_minutes}')::int=30;
 select * into strict d from public.deliveries where order_id=o.id;
 assert d.delivery_service='priority' and d.deliver_by=(o.receipt#>>'{delivery_eta,latest_at}')::timestamptz,'Courier deadline uses quoted area ETA';
 assert (select count(*) from public.orders where store_id=o.store_id)=2,'Retries and rejected priority schedule never create extra sales';
 assert pitacco_private.delivery_urgency('standard',now()-interval '1 minute',now())<pitacco_private.delivery_urgency('priority',now()+interval '10 minutes',now()),'Late orders are urgent';
 assert pitacco_private.delivery_urgency('priority',now()-interval '1 minute',now())=0;
end $test$;
update public.pitacco_delivery_route_quotes set expires_at=now()-interval '1 minute' where request_id in ('92000000-0000-0000-0000-000000000011','92000000-0000-0000-0000-000000000012');
update public.pitacco_store_hours set paused=true where store_id='91000000-0000-0000-0000-000000000002';
set local role anon;
do $test$
declare result jsonb;
begin
 assert cardinality(public.pitacco_public_schedule_slots('priority-recovery-fixture','delivery'))=0,'Manual pause removes all future slots';
 result:=public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000011','Cliente','21999999999','Rua Fixture 123','[{"product_id":"91000000-0000-0000-0000-000000000003","quantity":1,"options":[]}]','delivery','pix_manual','Complemento preservado','91000000-0000-0000-0000-000000000011');
 assert result=current_setting('test.priority.result')::jsonb,'Committed order recovers even after quote expires and store pauses';
 assert public.pitacco_delivery_quote_point('91000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000012','Rua Fixture 123') is null,'Expired quote never authorizes an uncommitted order';
 assert public.pitacco_delivery_quote_point('91000000-0000-0000-0000-000000000011',gen_random_uuid(),'Rua Fixture 123') is null,'Request capability must match the quote';
 assert public.pitacco_delivery_quote_point('91000000-0000-0000-0000-000000000011','92000000-0000-0000-0000-000000000011','Outro endereço') is null,'Original address must match';
 begin
  perform public.pitacco_checkout_quoted_delivery('priority-recovery-fixture','92000000-0000-0000-0000-000000000011','Cliente alterado','21999999999','Rua Fixture 123','[{"product_id":"91000000-0000-0000-0000-000000000003","quantity":1,"options":[]}]','delivery','pix_manual','Complemento preservado','91000000-0000-0000-0000-000000000011');
  raise exception 'TEST FAILURE: modified replay accepted';
 exception when raise_exception then
  if sqlerrm <> 'Chave reutilizada com dados diferentes' then raise;end if;
 end;
end $test$;

-- The same public customer path is used by plain and Fideliza+ checkout.
reset role;
insert into public.loyalty_coupons(store_id,code,discount_type,discount_value) values('91000000-0000-0000-0000-000000000002','AUTOACEITE','fixed',5);
update public.pitacco_store_hours set paused=false where store_id='91000000-0000-0000-0000-000000000002';
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare items jsonb:='[{"product_id":"91000000-0000-0000-0000-000000000003","quantity":1,"options":[]}]'; r jsonb; req uuid:=gen_random_uuid();
begin
 r:=public.pitacco_loyalty_checkout('priority-recovery-fixture',req,'Cliente','21999990081','',items,'pickup','dinheiro');
 assert r->>'status'='accepted','Anonymous Fideliza pickup must auto accept';
 assert public.pitacco_loyalty_checkout('priority-recovery-fixture',req,'Cliente','21999990081','',items,'pickup','dinheiro')=r,'Retry returns identical confirmation';
 r:=public.pitacco_loyalty_checkout('priority-recovery-fixture',gen_random_uuid(),'Cliente','21999990082','',items,'pickup','dinheiro','','','AUTOACEITE');
 assert r->>'status'='accepted' and (r->>'total')::numeric=20,'Coupon path also auto accepts';
end $test$;
reset role;
rollback;
