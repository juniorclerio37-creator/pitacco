begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','alerts-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','alerts-other@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Alert Store'),
 ('20000000-0000-0000-0000-000000000002','Other Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into public.orders(id,store_id,channel,gross,source,status,receipt,created_at,accepted_at,scheduled_for,scheduled_release_at) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','pending','{"display_number":"D-1","payment_status":"pending","phone":"test-private"}',now()-interval '11 minutes',null,null,null),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','accepted','{"display_number":"D-2","payment_status":"failed"}',now()-interval '60 minutes',now()-interval '31 minutes',null,null),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','pending','{"display_number":"D-3"}',now()-interval '30 minutes',null,now()+interval '3 hours',now()+interval '2 hours'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','cancelled','{"display_number":"D-4"}',now()-interval '10 minutes',null,null,null),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','Delivery próprio',20,'proprio','pending','{"display_number":"D-5"}',now()-interval '30 minutes',null,null,null);
insert into public.deliveries(id,store_id,order_id,customer_name,address,deliver_by)
 values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','Cliente','Endereço',now()-interval '1 minute');
insert into public.external_delivery_requests(store_id,provider,reference,customer_name,destination,status)
 values ('20000000-0000-0000-0000-000000000001','uber_direct','TEST','Cliente','Endereço','falhou');
insert into public.marketplace_acceptance_requests(id,store_id,order_id,source,state) values
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','ifood','rejected');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare
 result jsonb := public.pitacco_operational_alerts('20000000-0000-0000-0000-000000000001');
 codes text[];
begin
 select array_agg(event->>'code') into codes from jsonb_array_elements(result->'events') event;
 assert codes @> array['acceptance_late','preparation_late','order_cancelled','delivery_late','delivery_partner_failed','acceptance_partner_failed','payment_failed','no_courier'];
 assert not exists(select 1 from jsonb_array_elements(result->'events') event where event->>'reference' in ('D-3','D-5')), 'Future reservations and other stores do not create alerts';
 assert position('test-private' in result::text)=0, 'Alert omits buyer contact information';
 assert (result->'couriers'->>'available')::integer=0;
 begin
  perform public.pitacco_operational_alerts('20000000-0000-0000-0000-000000000002');
  raise exception 'Expected store mismatch rejection';
 exception when raise_exception then
  if sqlerrm <> 'Sem permissão para consultar alertas desta loja' then raise;end if;
 end;
end;
$test$;
rollback;
