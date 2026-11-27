begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','manager@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','outsider@example.invalid');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000001','Decision Store');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor');
insert into public.orders(id,store_id,channel,gross,source,status) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','pending'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','pending'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','pending'),
 ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','Delivery próprio',20,'proprio','accepted'),
 ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','iFood',20,'ifood','pending');
insert into public.store_payment_receipts(order_id) values ('30000000-0000-0000-0000-000000000003');

set local role anon;
do $test$
begin
 assert not has_function_privilege('anon','public.pitacco_decide_pending_order(uuid,text,text)','EXECUTE');
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
 begin
  perform public.pitacco_decide_pending_order('30000000-0000-0000-0000-000000000001','rejected','Sem estoque');
  raise exception 'Expected access restriction';
 exception when raise_exception then
  if sqlerrm <> 'Pedido indisponível para este usuário' then raise; end if;
 end;
end;
$test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare
 rejected uuid := '30000000-0000-0000-0000-000000000001';
 cancelled uuid := '30000000-0000-0000-0000-000000000002';
 paid uuid := '30000000-0000-0000-0000-000000000003';
 accepted uuid := '30000000-0000-0000-0000-000000000004';
 marketplace uuid := '30000000-0000-0000-0000-000000000005';
begin
 perform public.pitacco_decide_pending_order(rejected,'rejected','Sem estoque');
 perform public.pitacco_decide_pending_order(rejected,'rejected','Sem estoque');
 perform public.pitacco_decide_pending_order(cancelled,'cancelled','Cliente solicitou');
 assert (select status='rejected' from public.orders where id=rejected);
 assert (select status='cancelled' from public.orders where id=cancelled);
 assert (select count(*)=1 from public.operation_audit where order_id=rejected and action='order_rejected');
 assert (select details->>'reason'='Cliente solicitou' from public.operation_audit where order_id=cancelled and action='order_cancelled');
 begin
  perform public.pitacco_decide_pending_order(paid,'cancelled','Já pagou');
  raise exception 'Expected the paid order to remain open';
 exception when raise_exception then
  if sqlerrm <> 'O pedido já possui pagamento ou entrega registrada' then raise; end if;
 end;
 begin
  perform public.pitacco_decide_pending_order(accepted,'cancelled','Já aceito');
  raise exception 'Expected accepted order to remain open';
 exception when raise_exception then
  if sqlerrm <> 'A decisão só está disponível para pedidos próprios pendentes' then raise; end if;
 end;
 begin
  perform public.pitacco_decide_pending_order(marketplace,'rejected','Usar integração oficial');
  raise exception 'Expected marketplace order to remain open';
 exception when raise_exception then
  if sqlerrm <> 'A decisão só está disponível para pedidos próprios pendentes' then raise; end if;
 end;
end;
$test$;
rollback;
