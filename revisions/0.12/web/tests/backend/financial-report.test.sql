begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','report-manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','report-outsider@example.invalid');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Report Store'),
 ('20000000-0000-0000-0000-000000000002','Other Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');

insert into public.orders(id,store_id,channel,gross,fees,created_at,source,status) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','iFood',100,10,'2026-11-14T03:00:00Z','ifood','accepted'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','iFood',900,10,'2026-11-14T02:59:59Z','ifood','accepted'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Delivery próprio',50,0,'2026-11-15T02:59:59Z','proprio','pending'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','Delivery próprio',900,0,'2026-11-14T19:00:00Z','proprio','rejected'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','iFood',900,10,'2026-11-14T19:00:00Z','ifood','accepted');
insert into public.store_payment_receipts(order_id,store_id,amount,recorded_at) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',40,'2026-11-14T15:00:00Z'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',20,'2026-11-14T15:00:00Z'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002',100,'2026-11-14T15:00:00Z');
insert into public.expenses(store_id,description,amount,created_at) values
 ('20000000-0000-0000-0000-000000000001','Insumos',12,'2026-11-14T17:00:00Z');
insert into public.pitacco_courier_payouts(store_id,amount,created_at) values
 ('20000000-0000-0000-0000-000000000001',20,'2026-11-14T17:00:00Z');
insert into public.pitacco_order_costs(order_id,store_id,merchant_discount,goods_cost,processing_fees,delivery_cost,other_cost) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',5,22,3,8,2);

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare v_store uuid := '20000000-0000-0000-0000-000000000001'; report jsonb;
begin
 select jsonb_object_agg(metric,amount) into report from public.pitacco_period_financial_report(v_store,'2026-11-14','2026-11-14');
 assert report='{"vendas":100,"taxas":10,"pedidos_pendentes":50,"recebimentos":60,"despesas":12,"acertos_entregadores":20}'::jsonb,
   'Use Brazilian calendar dates, separate accrual and receipts, exclude rejected orders and isolate stores';
 assert (select count(*)=1 and min(result)=55 and min(direct_cost)=35 and min(merchant_discount)=5
   from public.pitacco_order_profit_report(v_store,'2026-11-14','2026-11-14'));
 assert (select count(*)=1 and bool_and(result is null)
   from public.pitacco_order_profit_report(v_store,'2026-11-13','2026-11-13'));
 begin
  perform public.pitacco_order_profit_report('20000000-0000-0000-0000-000000000002','2026-11-14','2026-11-14');
  raise exception 'Expected order profit report access restriction';
 exception when raise_exception then
  if sqlerrm not like 'Sem permissão%' then raise; end if;
 end;
 begin
  perform public.pitacco_period_financial_report('20000000-0000-0000-0000-000000000002','2026-11-14','2026-11-14');
  raise exception 'Expected report access restriction';
 exception when raise_exception then
  if sqlerrm not like 'Sem permissão%' then raise; end if;
 end;
end;
$test$;
reset role;
insert into public.orders(id,store_id,channel,gross,fees,created_at,source,status,receipt) values
 ('30000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001','Delivery próprio',103,0,'2026-11-16T03:00:00Z','proprio','accepted','{"payment_price":{"adjustment_cents":300}}'),
 ('30000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001','Delivery próprio',95,0,'2026-11-16T05:00:00Z','proprio','accepted','{"payment_price":{"adjustment_cents":-500}}'),
 ('30000000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000001','Delivery próprio',104,0,'2026-11-16T05:00:00Z','proprio','cancelled','{"payment_price":{"adjustment_cents":400}}'),
 ('30000000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000002','Delivery próprio',108,0,'2026-11-16T05:00:00Z','proprio','accepted','{"payment_price":{"adjustment_cents":800}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare report jsonb;
begin
 select jsonb_object_agg(metric,amount) into report from public.pitacco_period_financial_report('20000000-0000-0000-0000-000000000001','2026-11-16','2026-11-16');
 assert (report->>'vendas')::numeric=198,'Gross includes adjustments only once';
 assert (report->>'acrescimos_pagamento')::numeric=3,'Do not count cancelled sales or other stores';
 assert (report->>'descontos_pagamento')::numeric=5;
end $test$;
rollback;
