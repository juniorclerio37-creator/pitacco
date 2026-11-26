CREATE OR REPLACE FUNCTION public.pitacco_ifood_driver_result(p_delivery uuid, p_external uuid, p_action text, p_success boolean, p_permanent boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.deliveries%rowtype;
begin
 if p_action not in ('arrival','verify') then raise exception 'Ação inválida'; end if;
 select src.* into d from public.deliveries src
 join pitacco_private.ifood_order_links l on l.order_id=src.order_id and l.external_id=p_external
 join pitacco_private.ifood_merchants m on m.merchant_id=l.merchant_id and m.store_id=src.store_id and m.enabled
 where src.id=p_delivery and src.source='ifood' and src.logistics_provider='loja'
 for update of src;
 if not found or d.arrived_at is null then return false; end if;
 if p_action='arrival' then
  if d.status<>'retirada' then return false;end if;

  -- Segunda barreira: uma alteração entre autorização e persistência
  -- também não pode confirmar uma chegada sem DISPATCHED oficial.
  if not exists(
    select 1 from public.orders o
    where o.id=d.order_id and o.store_id=d.store_id and o.source='ifood'
      and o.status='accepted'
      and o.receipt->>'ifood_status'='DISPATCHED'
  ) then return false;end if;
  update public.deliveries set arrival_provider_state=case
    when p_success then 'submitted'
    when p_permanent then 'unavailable' else 'failed' end
   where id=d.id and arrival_provider_state not in ('submitted','confirmed');
  insert into public.operation_audit(store_id,order_id,action,details)
   values(d.store_id,d.order_id,'ifood_arrival_result',
      pg_catalog.jsonb_build_object('delivery',d.id,'success',p_success,'permanent',p_permanent));
  return true;
 end if;
 -- A valid official API response can race the official CONCLUDED webhook.
 -- Record a verified code only when iFood returned valid:true, never merely because a delivery is closed.
 if p_action='verify' and p_success and d.status='entregue' and exists(
    select 1 from public.orders o where o.id=d.order_id and o.store_id=d.store_id
      and o.source='ifood' and o.receipt->>'ifood_status'='CONCLUDED'
 ) then
  if d.delivery_code_verified_at is null then
   update public.deliveries set delivery_code_verified_at=pg_catalog.now() where id=d.id;
   insert into public.operation_audit(store_id,order_id,action,details)
    values(d.store_id,d.order_id,'ifood_code_verified',pg_catalog.jsonb_build_object('delivery',d.id,'verified',true,'official_event_first',true));
  end if;
  return true;
 end if;
 if p_action='verify' and p_success and d.status='retirada' then
  update public.deliveries set delivery_code_verified_at=pg_catalog.now(),
     status='entregue', updated_at=pg_catalog.now() where id=d.id;
  insert into public.operation_audit(store_id,order_id,action,details)
   values(d.store_id,d.order_id,'ifood_code_verified',
      pg_catalog.jsonb_build_object('delivery',d.id,'verified',true));
  return true;
 end if;
 return false;
end $function$;
revoke all on function public.pitacco_ifood_driver_result(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_driver_result(uuid,uuid,text,boolean,boolean) to service_role;