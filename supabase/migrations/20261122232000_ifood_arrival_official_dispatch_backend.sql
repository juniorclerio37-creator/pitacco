-- iFood: evitar evento externo de chegada antes da confirmação oficial DISPATCHED.
-- Só modifica duas RPCs existentes; preserva coleta local e PIN de quatro dígitos.
-- Definições obtidas e conferidas diretamente no Supabase produção.
CREATE OR REPLACE FUNCTION public.pitacco_driver_ifood_action(p_delivery uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 d public.deliveries%rowtype;
 v_external uuid;
 v_merchant uuid;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão não autorizada' using errcode='42501'; end if;
 if p_action not in ('arrival','verify') then raise exception 'Ação inválida' using errcode='22023';end if;
 select src.* into d from public.deliveries src
 join public.couriers c on c.id=src.courier_id and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))
 where src.id=p_delivery and c.user_id=(select auth.uid()) and c.active
   and src.source='ifood' and src.logistics_provider='loja'
   and src.status='retirada' and src.arrived_at is not null;
 if not found then raise exception 'Entrega iFood não atribuída ou ainda não chegada' using errcode='42501'; end if;
 if p_action='arrival' and d.arrival_provider_state in ('submitted','confirmed') then
   return pg_catalog.jsonb_build_object('already',true,'state',d.arrival_provider_state);
 end if;

 -- Exige o evento OFICIAL DISPATCHED registrado pelo webhook do iFood,
 -- não somente o status local de saída nem HTTP 202 do /dispatch.
 -- A chegada física permanece gravada separadamente no Pitacco.
 if p_action='arrival' and not exists(
    select 1 from public.orders o
    where o.id=d.order_id and o.store_id=d.store_id and o.source='ifood'
      and o.status='accepted'
      and o.receipt->>'ifood_status'='DISPATCHED'
 ) then
   raise exception 'Aguarde a confirmação oficial DISPATCHED do iFood antes de comunicar a chegada'
      using errcode='22023';
 end if;
 select l.external_id,m.merchant_id into v_external,v_merchant
 from pitacco_private.ifood_order_links l
 join pitacco_private.ifood_merchants m on m.merchant_id=l.merchant_id
 where l.order_id=d.order_id and m.store_id=d.store_id and m.enabled;
 if v_external is null or v_merchant is null then
   raise exception 'Conexão logística iFood não homologada para esta loja' using errcode='22023'; end if;
 return pg_catalog.jsonb_build_object('already',false,'external_order_id',v_external,'merchant_id',v_merchant);
end $function$


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
 if p_action='verify' and p_success and d.status='retirada' then
  update public.deliveries set delivery_code_verified_at=pg_catalog.now(),
     status='entregue', updated_at=pg_catalog.now() where id=d.id;
  insert into public.operation_audit(store_id,order_id,action,details)
   values(d.store_id,d.order_id,'ifood_code_verified',
      pg_catalog.jsonb_build_object('delivery',d.id,'verified',true));
  return true;
 end if;
 return false;
end $function$


-- As permissões originais são preservadas pela substituição das funções.
notify pgrst,'reload schema';
