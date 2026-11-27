-- CI only. Install the original routing trigger inside a rollback transaction
-- (strip its outer begin/commit in the workflow before execution).
begin;
-- Test-only inclusion: original script uses BEGIN/COMMIT, so run only its
-- trigger definition in a separate file generated from the exact source.
\i /tmp/core-original-print-routing.sql
do $check$
declare
 s uuid:='20000000-0000-4000-8000-000000000001';
 oid uuid:=gen_random_uuid();
 zero uuid:='00000000-0000-0000-0000-000000000000';
 manual uuid:=gen_random_uuid();
 body jsonb:='{"source":"ifood","display_number":"TESTE","items":[{"name":"Açaí","category":"Bebidas","quantity":1},{"name":"Pizza","category":"Pizzas","quantity":1}],"total":25}';
begin
 insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt)
 values(oid,s,'iFood',25,'ifood','accepted','ready',body);
 insert into public.print_sectors(store_id,sector,printer,width,copies,sources,categories)
 values(s,'fixture-bebidas','TEST-80',80,1,array['ifood'],array['bebidas']),
 (s,'fixture-proprio','TEST-58',58,1,array['proprio'],array[]::text[]),
 (s,'fixture-pizzas','TEST-58',58,1,array['ifood'],array['PIZZAS']);
 insert into pitacco_private.auto_print_preferences(store_id,enabled) values(s,false)
 on conflict(store_id) do update set enabled=false;
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,request_id,receipt,receipt_text)
 values(s,oid,'fixture-bebidas','TEST-80',80,1,zero,body,'TESTE');
 if exists(select 1 from public.print_jobs where order_id=oid) then raise exception 'Automatic print preference ignored';end if;
 -- Manual reprint is still allowed and respects original sector routing.
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,request_id,receipt,receipt_text)
 select s,oid,p.sector,p.printer,p.width,1,manual,body,'TESTE' from public.print_sectors p where p.store_id=s and p.sector like 'fixture-%';
 if (select count(*) from public.print_jobs where order_id=oid)<>2 then raise exception 'Source filter mismatch';end if;
 if not exists(select 1 from public.print_jobs where order_id=oid and sector='fixture-bebidas' and width=80 and jsonb_array_length(receipt->'items')=1 and receipt->'items'->0->>'name'='Açaí') then raise exception 'Beverage category mismatch';end if;
 if not exists(select 1 from public.print_jobs where order_id=oid and sector='fixture-pizzas' and width=58 and jsonb_array_length(receipt->'items')=1 and receipt->'items'->0->>'name'='Pizza') then raise exception 'Pizza category mismatch';end if;
 update pitacco_private.auto_print_preferences set enabled=true,enabled_since=clock_timestamp() where store_id=s;
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,request_id,receipt,receipt_text)
 values(s,oid,'fixture-bebidas','TEST-80',80,1,zero,body,'TESTE');
 if exists(select 1 from public.print_jobs where order_id=oid and request_id=zero) then raise exception 'Historical job printed after reactivation';end if;
 update public.orders set accepted_at=clock_timestamp()+interval '1 second' where id=oid;
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,request_id,receipt,receipt_text)
 values(s,oid,'fixture-bebidas','TEST-80',80,1,zero,body,'TESTE') on conflict do nothing;
 if not exists(select 1 from public.print_jobs where order_id=oid and request_id=zero and sector='fixture-bebidas') then raise exception 'Fresh automatic print missing';end if;
end $check$;
rollback;
