-- Disposable CI only. Diagnostic, not a production ledger or settlement routine.
-- Never add manual, courier and cash-ledger amounts together.
begin;
create function pg_temp.receipt_reconciliation(p_store uuid,p_order uuid)
returns jsonb language sql stable as $audit$
 with base as (
  select o.id,o.store_id,o.gross,o.receipt,o.status,
   coalesce(o.receipt->>'payment','') as method
  from public.orders o where o.store_id=p_store and o.id=p_order and o.source='proprio'
 ), evidence as (
  select b.*,
   m.amount as manual_amount,
   case when b.receipt->'courier_collection'->>'received'='true'
     and jsonb_typeof(b.receipt->'courier_collection'->'amount')='number'
    then (b.receipt->'courier_collection'->>'amount')::numeric end as courier_amount,
   coalesce(b.receipt->'courier_collection'->>'received','false')='true' as courier_declared,
   l.entries,l.amount as ledger_amount
  from base b
  left join public.manual_payments m on m.order_id=b.id and m.store_id=b.store_id
  cross join lateral (
    select count(*) as entries,coalesce(sum(r.amount),0) as amount
    from public.store_payment_receipts r where r.order_id=b.id and r.store_id=b.store_id
  ) l
 )
 select jsonb_build_object('gross',gross,'method',method,
  'manual_amount',manual_amount,'courier_amount',courier_amount,
  'ledger_entries',entries,'ledger_amount',ledger_amount,
  'state',case
   when method not in ('pix_manual','dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket') then 'specialized'
   when status in ('cancelled','rejected') then 'cancelled_review'
   when (manual_amount is not null and manual_amount<>gross)
     or (courier_declared and courier_amount is distinct from gross)
     or (entries>0 and ledger_amount<>gross) then 'amount_review'
   when manual_amount is not null and courier_declared then 'overlap_review'
   when entries>1 then 'multiple_ledger_entries_review'
   when entries=1 and (manual_amount is not null or courier_declared) then 'matched_amounts'
   when entries=0 and (manual_amount is not null or courier_declared) then 'missing_ledger_review'
   when entries>0 then 'ledger_only_review'
   else 'unconfirmed' end)
 from evidence
$audit$;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
do $test$
declare
 s constant uuid:='91000000-0000-0000-0000-000000000002';
 oid uuid; r jsonb; v_now timestamptz:=now();
begin
 -- Existing synthetic cash pickup created by the Laravel checkout regression.
 select o.id into strict oid from public.orders o join public.public_checkouts c on c.order_id=o.id and c.store_id=o.store_id
 where c.store_id=s and c.phone='21988889111' and o.receipt->>'payment'='dinheiro';
 assert pg_temp.receipt_reconciliation(s,oid)->>'state'='unconfirmed';
 assert pg_temp.receipt_reconciliation(gen_random_uuid(),oid) is null;
 perform public.confirm_manual_payment(oid,gen_random_uuid(),25,'Conciliação fictícia');
 r:=pg_temp.receipt_reconciliation(s,oid);
 -- Observe the reconstructed schema, not production. No automatic backfill.
 raise notice 'Original manual confirmation: ledger_entries=%, ledger_amount=%, state=%',r->>'ledger_entries',r->>'ledger_amount',r->>'state';
 assert (r->>'manual_amount')::numeric=25;
 -- Control the synthetic evidence for deterministic classifier tests.
 delete from public.store_payment_receipts where order_id=oid and store_id=s;
 assert pg_temp.receipt_reconciliation(s,oid)->>'state'='missing_ledger_review';
 insert into public.store_payment_receipts(order_id,store_id,amount,recorded_at) values(oid,s,25,v_now);
 r:=pg_temp.receipt_reconciliation(s,oid);
 assert r->>'state'='matched_amounts';
 assert (r->>'ledger_amount')::numeric=25,'Matched records do not double the cash ledger';
 -- Synthetic overlapping courier declaration: this is deliberately not the real courier RPC.
 update public.orders set receipt=receipt||'{"courier_collection":{"received":true,"amount":25}}'::jsonb where id=oid and store_id=s;
 assert pg_temp.receipt_reconciliation(s,oid)->>'state'='overlap_review';
 assert (pg_temp.receipt_reconciliation(s,oid)->>'ledger_amount')::numeric=25;
 update public.orders set receipt=receipt-'courier_collection' where id=oid and store_id=s;
 insert into public.store_payment_receipts(order_id,store_id,amount,recorded_at) values(oid,s,25,v_now);
 assert pg_temp.receipt_reconciliation(s,oid)->>'state'='amount_review';
 -- A matching total split into multiple records is not silently called a duplicate.
 delete from public.store_payment_receipts where order_id=oid and store_id=s;
 insert into public.store_payment_receipts(order_id,store_id,amount,recorded_at) values(oid,s,10,v_now),(oid,s,15,v_now);
 assert pg_temp.receipt_reconciliation(s,oid)->>'state'='multiple_ledger_entries_review';
 -- No state is an authorization to mark paid, refund or rewrite historical data.
 raise notice 'PASS: synthetic reconciliation diagnostic, missing ledger, matching amount, overlap, divergent and split evidence, store isolation';
end $test$;
rollback;
