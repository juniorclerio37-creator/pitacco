-- The cross-store test grant permits operational testing, not real earnings.
do $patch$
declare f text; revised text;
begin
 select pg_get_functiondef('public.pitacco_driver_earnings(text)'::regprocedure) into f;
 if position('and (d.store_id = v_store or public.pitacco_courier_test_access(v_courier,d.store_id))' in f)=0
 or position('and (a.store_id=v_store or public.pitacco_courier_test_access(v_courier,a.store_id))' in f)=0 then
  raise exception 'Unexpected earnings function definition';
 end if;
 revised:=replace(f,'and (d.store_id = v_store or public.pitacco_courier_test_access(v_courier,d.store_id))',
 $condition$and d.store_id = v_store
       and (o.receipt->>'ifood_test') is distinct from 'true'
       and not exists (select 1 from pitacco_private.ifood_merchants m where m.store_id=d.store_id and m.test_only and not exists (select 1 from pitacco_private.ifood_merchants live where live.store_id=d.store_id and not live.test_only))$condition$);
 revised:=replace(revised,'and (a.store_id=v_store or public.pitacco_courier_test_access(v_courier,a.store_id))',
 $condition$and a.store_id=v_store
      and not exists (select 1 from pitacco_private.ifood_merchants m where m.store_id=a.store_id and m.test_only and not exists (select 1 from pitacco_private.ifood_merchants live where live.store_id=a.store_id and not live.test_only))$condition$);
 execute revised;
end $patch$;
