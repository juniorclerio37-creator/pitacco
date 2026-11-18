-- External iFood confirmation is an official delivery proof.
-- The existing BEFORE UPDATE trigger requires delivery_code_verified_at for
-- courier deliveries; set it from the processed official CONCLUDED event time,
-- NEVER from a courier's click or an untrusted client-supplied PIN.
do $patch$
declare
 v_oid oid;
 v_body text;
 v_old text;
 v_new text;
begin
 v_oid:=pg_catalog.to_regprocedure('public.pitacco_driver_reconcile_ifood(uuid)');
 if v_oid is null then
   raise notice 'External reconciliation is absent in an isolated fixture';
 else
   v_body:=pg_catalog.pg_get_functiondef(v_oid);
   v_old:=$needle$update public.deliveries set status='entregue',updated_at=pg_catalog.now()
 where id=d.id and status='retirada';$needle$;
   v_new:=$needle$update public.deliveries
 set delivery_code_verified_at=(
   select pg_catalog.max(e.event_at)
   from pitacco_private.ifood_order_links l
   join pitacco_private.ifood_events e
     on e.order_id=l.external_id and e.merchant_id=l.merchant_id
   where l.order_id=d.order_id and e.code='CONCLUDED'
     and e.done_at is not null and e.event_at>=d.arrived_at
 ),status='entregue',updated_at=pg_catalog.now()
 where id=d.id and status='retirada';$needle$;
   if pg_catalog.strpos(v_body,v_old)=0 then
     raise exception 'Unexpected external iFood reconciliation implementation; refusing unsafe patch';
   end if;
   execute pg_catalog.replace(v_body,v_old,v_new);
 end if;
end
$patch$;
notify pgrst,'reload schema';
