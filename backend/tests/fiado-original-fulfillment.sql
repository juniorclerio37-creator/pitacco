-- Existing original SQL contract only. Disposable CI database; always rolled back.
-- The preceding checkout smoke fixture already provisions this fictional customer.
begin;
do $test$
declare
 s constant uuid:='91000000-0000-0000-0000-000000000002';
 slug constant text:='core-checkout-fixture';
 fixture_phone constant text:='21988889991';
 items constant jsonb:='[{"product_id":"91000000-0000-0000-0000-000000000003","quantity":1,"options":[]}]';
 cid uuid; initial_used numeric; rid uuid; qid uuid; slot timestamptz;
 verified jsonb; result jsonb; oid uuid; replay jsonb;
begin
 select id,used into strict cid,initial_used from public.pitacco_fiado_customers
 where store_id=s and pitacco_fiado_customers.phone=fixture_phone;
 -- Preserve the previous test's actual ledger; reserve and release new credit.
 rid:=gen_random_uuid(); qid:=gen_random_uuid();
 insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,delivery_min_minutes,delivery_max_minutes,delivery_region,delivery_service)
 select qid,s,rid,'Rua Fixture 456',500,9,updated_at,now()+interval '10 minutes',-22.91,-43.46,20,30,'Centro','priority'
 from public.pitacco_delivery_pricing where store_id=s;
 assert found,'Synthetic priority quote must exist';
 verified:=public.pitacco_fiado_verify_pin(slug,fixture_phone,'438216',rid);
 assert (verified->>'verified')::boolean,'Original verifier must authorize synthetic customer';
 result:=public.pitacco_checkout_fiado(slug,rid,'Cliente Extrato Fixture',fixture_phone,'Rua Fixture 456',items,'delivery','',verified->>'token',qid);
 assert result->>'order_id' is not null,'Original delivery checkout must confirm';
 oid:=(result->>'order_id')::uuid;
 assert (result->>'total')::numeric=34,'Priority fee included in debt';
 assert (select amount=34 from public.pitacco_fiado_charges where order_id=oid);
 assert (select used=initial_used+34 from public.pitacco_fiado_customers where id=cid);
 replay:=public.pitacco_checkout_fiado(slug,rid,'Cliente Extrato Fixture',fixture_phone,'Rua Fixture 456',items,'delivery','',verified->>'token',qid);
 assert replay->>'order_id'=result->>'order_id','Same confirmation must recover same order';
 assert (select used=initial_used+34 from public.pitacco_fiado_customers where id=cid);
 update public.orders set status='cancelled' where id=oid;
 assert (select used=initial_used from public.pitacco_fiado_customers where id=cid),'Cancellation restores only reserved credit';
 assert not exists(select 1 from public.loyalty_ledger where order_id=oid and event_type in ('earn','redeem'));
 -- Scheduled pickup must await manual operational acceptance regardless of auto-credit approval.
 slot:=(public.pitacco_public_schedule_slots(slug,'pickup'))[1];
 assert slot is not null;
 rid:=gen_random_uuid();
 verified:=public.pitacco_fiado_verify_pin(slug,fixture_phone,'438216',rid);
 assert (verified->>'verified')::boolean;
 result:=public.pitacco_checkout_fiado(slug,rid,'Cliente Extrato Fixture',fixture_phone,'',items,'pickup','',verified->>'token',null,slot);
 assert result->>'order_id' is not null;
 oid:=(result->>'order_id')::uuid;
 assert (result->>'total')::numeric=25;
 assert (select status='pending' from public.orders where id=oid),'Scheduled orders must await store acceptance';
 assert (select used=initial_used+25 from public.pitacco_fiado_customers where id=cid);
 update public.orders set status='cancelled' where id=oid;
 assert (select used=initial_used from public.pitacco_fiado_customers where id=cid);
 assert not exists(select 1 from public.loyalty_ledger where order_id=oid and event_type in ('earn','redeem'));
 raise notice 'PASS: original Fiado priority delivery, retry, scheduled pickup, cancellation, credit and loyalty exclusion';
end $test$;
rollback;
