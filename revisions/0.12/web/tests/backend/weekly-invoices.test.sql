
begin;
insert into auth.users(id,email) values ('11000000-0000-0000-0000-000000000001','weekly-manager@example.invalid');
insert into public.stores(id,name) values
 ('21000000-0000-0000-0000-000000000001','Weekly enabled'),
 ('21000000-0000-0000-0000-000000000002','Existing monthly store'),
 ('21000000-0000-0000-0000-000000000003','Weekly empty');
insert into public.store_members values
 ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','gestor');

do $$
declare
 active_store uuid:='21000000-0000-0000-0000-000000000001';
 legacy_store uuid:='21000000-0000-0000-0000-000000000002';
 empty_store uuid:='21000000-0000-0000-0000-000000000003';
 manager uuid:='11000000-0000-0000-0000-000000000001';
 period record;
 current_week date;
 order_key uuid;
 request_key uuid;
 store_key uuid;
 receipt jsonb;
 sale_source text;
 invoice uuid;
 second_invoice uuid;
 closed pitacco_private.weekly_invoices%rowtype;
begin
 select week_start into current_week from pitacco_private.weekly_commission_period(now());
 select * into period from pitacco_private.weekly_commission_period((current_week-14)::timestamp at time zone 'America/Sao_Paulo');
 insert into pitacco_private.commission_enrollments(store_id,starts_at)
 values(active_store,period.period_start),(empty_store,period.period_start);

 for n in 1..8 loop
  order_key:=('31000000-0000-0000-0000-00000000000'||n)::uuid;
  request_key:=('41000000-0000-0000-0000-00000000000'||n)::uuid;
  store_key:=case when n=5 then legacy_store else active_store end;
  sale_source:=case when n=6 then 'ifood' else 'proprio' end;
  receipt:=jsonb_build_object('subtotal',100,'discount',10,'delivery_fee',8,'logistics','retirada','is_test',n=4);
  insert into public.orders(id,store_id,channel,source,gross,status,preparation_status,request_id,receipt,created_at)
  values(order_key,store_key,case when n=6 then 'iFood' else 'Delivery próprio' end,sale_source,98,'accepted','ready',request_key,receipt,period.period_start+interval '1 hour');
  insert into public.public_checkouts(order_id,store_id,request_id,created_at,payload,payment_instructions)
  values(order_key,store_key,request_key,period.period_start+interval '1 hour','{}','');
  if n=7 then
   insert into public.deliveries(order_id,store_id,customer_name,address,status)
    values(order_key,store_key,'Teste','Teste','retirada');
   update public.deliveries set status='entregue' where order_id=order_key;
  elsif n<>8 then
   update public.orders set preparation_status='completed' where id=order_key;
   if n=2 then update public.orders set status='cancelled' where id=order_key; end if;
  end if;
  if n<>3 then
   insert into public.manual_payments(order_id,store_id,request_id,amount,reference,confirmed_by,confirmed_at)
   values(order_key,store_key,request_key,98,'fixture',manager,
    case when n=7 then period.period_end else period.period_start+interval '2 hours' end);
  end if;
 end loop;
 -- Both completion paths are exercised before placing timestamps in a closed reporting period.
 assert (select count(*) from pitacco_private.commission_orders where completed_at is not null)=4;
 assert (select count(*) from pitacco_private.commission_orders)=5;
 update pitacco_private.commission_orders set completed_at=period.period_start+interval '3 hours' where completed_at is not null;

 -- The invoice uses the original checkout amount after an operational receipt edit.
 update public.orders set receipt=jsonb_set(receipt,'{subtotal}','1') where id='31000000-0000-0000-0000-000000000001';
 assert pitacco_private.close_commission_week(legacy_store,period.week_start) is null;
 invoice:=pitacco_private.close_commission_week(active_store,period.week_start);
 assert invoice=pitacco_private.close_commission_week(active_store,period.week_start);
 select * into closed from pitacco_private.weekly_invoices where id=invoice;
 assert closed.order_count=1 and closed.amount_cents=450 and closed.base_cents=9000;
 assert closed.delivery_cents=800 and closed.discount_cents=1000 and closed.product_cents=10000;
 assert closed.due_at=period.due_at and closed.grace_until=period.grace_until;
 assert (select order_id from pitacco_private.weekly_invoice_orders where invoice_id=invoice)='31000000-0000-0000-0000-000000000001'::uuid;

 second_invoice:=pitacco_private.close_commission_week(active_store,period.week_start+7);
 assert (select order_count=1 and amount_cents=450 from pitacco_private.weekly_invoices where id=second_invoice);
 assert (select order_id from pitacco_private.weekly_invoice_orders where invoice_id=second_invoice)='31000000-0000-0000-0000-000000000007'::uuid;
 assert (select count(*) from pitacco_private.weekly_invoice_orders where store_id=active_store)=2;

 invoice:=pitacco_private.close_commission_week(empty_store,period.week_start);
 assert (select order_count=0 and amount_cents=0 from pitacco_private.weekly_invoices where id=invoice);
 assert not exists(select 1 from pitacco_private.weekly_invoice_orders where invoice_id=invoice);
 begin
  perform pitacco_private.close_commission_week(active_store,current_week);
  raise exception 'A semana aberta deve ser recusada';
 exception when invalid_parameter_value then null;
 end;
 assert not has_table_privilege('authenticated','pitacco_private.weekly_invoices','select');
 assert not has_table_privilege('anon','pitacco_private.weekly_invoice_orders','select');
 assert not has_function_privilege('authenticated','pitacco_private.close_commission_week(uuid,date)','execute');
end $$;
rollback;
