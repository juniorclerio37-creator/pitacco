begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','billing-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','billing-outsider@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','billing-admin@example.invalid');
update public.profiles set role='admin' where id='10000000-0000-0000-0000-000000000003';
insert into pitacco_private.platform_owner(user_id) values ('10000000-0000-0000-0000-000000000003');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Expired Store'),
 ('20000000-0000-0000-0000-000000000002','Trial Store'),
 ('20000000-0000-0000-0000-000000000003','Legacy Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into public.pitacco_signup_trials(user_id,first_store_id,started_at,ends_at) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now()-interval '8 days',now()-interval '1 day'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',now(),now()+interval '7 days');
insert into public.orders(id,store_id,channel,gross,source,status) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','pending');
update pitacco_private.subscription_control set regularization_url='https://billing.example.invalid/',enforce_new_orders=true;

do $test$
begin
 assert not has_function_privilege('authenticated','public.pitacco_record_confirmed_subscription_payment(uuid,text,text,numeric)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_record_confirmed_subscription_payment(uuid,text,text,numeric)','EXECUTE');

 begin
  insert into public.orders(store_id,channel,gross,status) values ('20000000-0000-0000-0000-000000000001','Delivery próprio',20,'pending');
  raise exception 'Expected a new order to be blocked';
 exception when raise_exception then
  if sqlerrm <> 'Loja temporariamente indisponível para novos pedidos' then raise; end if;
 end;
 update public.orders set status='accepted' where id='30000000-0000-0000-0000-000000000001';
 insert into public.orders(store_id,channel,gross,status) values
  ('20000000-0000-0000-0000-000000000001','Delivery próprio',15,'historical'),
  ('20000000-0000-0000-0000-000000000002','Delivery próprio',20,'pending'),
  ('20000000-0000-0000-0000-000000000003','Delivery próprio',20,'pending');
end;
$test$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare state jsonb;
begin
 state:=public.pitacco_store_subscription_status('20000000-0000-0000-0000-000000000001');
 assert state->>'status'='overdue' and state->>'orders_blocked'='true';
 assert state->>'regularization_url'='https://billing.example.invalid/';
 begin
  perform public.pitacco_store_subscription_status('20000000-0000-0000-0000-000000000002');
  raise exception 'Expected access restriction';
 exception when raise_exception then
  if sqlerrm <> 'Sem permissão para consultar a assinatura desta loja' then raise;end if;
 end;
 begin
  perform public.pitacco_subscription_overview();
  raise exception 'Expected overview access restriction';
 exception when raise_exception then
  if sqlerrm <> 'Acesso reservado à administração do Pitacco' then raise;end if;
 end;
end;
$test$;

set local role service_role;
do $test$
declare first_coverage timestamptz; replay timestamptz;
begin
 begin
  perform public.pitacco_record_confirmed_subscription_payment('20000000-0000-0000-0000-000000000001','asaas','payment-1',55);
  raise exception 'Expected amount validation';
 exception when raise_exception then
  if sqlerrm <> 'Pagamento da assinatura inválido' then raise;end if;
 end;
 first_coverage:=public.pitacco_record_confirmed_subscription_payment('20000000-0000-0000-0000-000000000001','asaas','payment-1',59.90);
 replay:=public.pitacco_record_confirmed_subscription_payment('20000000-0000-0000-0000-000000000001','asaas','payment-1',59.90);
 assert replay=first_coverage, 'A replay does not extend subscription twice';
 begin
  perform public.pitacco_record_confirmed_subscription_payment('20000000-0000-0000-0000-000000000002','asaas','payment-1',59.90);
  raise exception 'Expected a confirmed payment to belong to one store';
 exception when raise_exception then
  if sqlerrm <> 'Pagamento vinculado a outro estabelecimento' then raise;end if;
 end;
end;
$test$;

reset role;
insert into public.orders(store_id,channel,gross,status)
 values ('20000000-0000-0000-0000-000000000001','Delivery próprio',20,'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $test$
declare report jsonb:=public.pitacco_subscription_overview();
begin
 assert report->>'registered'='3' and report->>'active'='1' and report->>'trial'='1' and report->>'legacy'='1';
 assert (report->>'monthly_recurring_revenue')::numeric=59.90;
 assert (public.pitacco_store_subscription_status('20000000-0000-0000-0000-000000000001'))->>'orders_blocked'='false';
end;
$test$;
rollback;
