-- Disposable CI only, existing authorized merchant SQL. No provider calls.
-- All changes are rolled back, including synthetic manual receipts and audit events.
begin;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
do $test$
declare
 s constant uuid:='91000000-0000-0000-0000-000000000002';
 methods constant text[]:=array['pix_manual','dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket'];
 method text; i int:=0; oid uuid; rid uuid; amt numeric; expected_phone text;
begin
 foreach method in array methods loop
  expected_phone:='21988889'||lpad((110+i)::text,3,'0');
  select o.id,o.gross into strict oid,amt
  from public.public_checkouts c join public.orders o on o.id=c.order_id and o.store_id=c.store_id
  where c.store_id=s and c.phone=expected_phone and o.receipt->>'payment'=method;
  assert amt=25;
  assert not exists(select 1 from public.manual_payments where order_id=oid);
  rid:=gen_random_uuid();
  begin
   perform public.confirm_manual_payment(oid,rid,amt-1,'Recebimento fictício');
   raise exception 'Expected wrong amount rejection';
  exception when raise_exception then
   if sqlerrm not like 'Confira valor integral%' then raise; end if;
  end;
  assert not exists(select 1 from public.manual_payments where order_id=oid);
  perform public.confirm_manual_payment(oid,rid,amt,'Recebimento fictício');
  perform public.confirm_manual_payment(oid,rid,amt,'Recebimento fictício');
  assert (select count(*)=1 and sum(amount)=amt from public.manual_payments where order_id=oid and store_id=s);
  assert (select count(*)=1 from public.operation_audit where order_id=oid and action='manual_payment_confirmed');
  begin
   perform public.confirm_manual_payment(oid,gen_random_uuid(),amt,'Segunda confirmação fictícia');
   raise exception 'Expected duplicate rejection';
  exception when raise_exception then
   if sqlerrm not like 'Pagamento ja registrado%' then raise; end if;
  end;
  i:=i+1;
 end loop;
 assert not has_function_privilege('anon','public.confirm_manual_payment(uuid,uuid,numeric,text)','execute');
 raise notice 'PASS: original merchant receipts for ten offline methods, exact amount, replay and duplicate protection';
end $test$;
rollback;
