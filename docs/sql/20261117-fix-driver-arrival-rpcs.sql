-- Corrige referências ambíguas nas RPCs de chegada e comprovação já instaladas.
-- Preserva os grants, os dados, os estados e as regras de autorização existentes.

create or replace function public.pitacco_driver_arrive(p_delivery uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 d public.deliveries%rowtype;
 v_source text;
 v_state text;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select src.* into d
 from public.deliveries src
 join public.couriers c on c.id=src.courier_id and c.store_id=src.store_id
 where src.id=p_delivery and c.active and c.user_id=(select auth.uid())
   and src.logistics_provider='loja'
 for update of src;
 if not found then raise exception 'Entrega não atribuída' using errcode='42501'; end if;
 if d.arrived_at is not null then
  return pg_catalog.jsonb_build_object('arrived_at',d.arrived_at,'provider_state',d.arrival_provider_state);
 end if;
 if d.status<>'retirada' or d.collected_at is null then
   raise exception 'Confirme a coleta e saída da loja antes da chegada' using errcode='22023';
 end if;
 v_source:=lower(coalesce(d.source,''));
 v_state:=case when v_source='ifood' then 'pending'
               when v_source in ('99food','keeta') then 'unavailable'
               else 'local' end;
 update public.deliveries
 set arrived_at=pg_catalog.now(),arrival_provider_state=v_state,updated_at=pg_catalog.now()
 where id=d.id returning * into d;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(d.store_id,d.order_id,(select auth.uid()),'courier_arrived',
    pg_catalog.jsonb_build_object('delivery',d.id,'source',v_source,'provider_state',v_state));
 if v_source='proprio' and d.order_id is not null
    and exists(select 1 from public.public_checkouts c where c.store_id=d.store_id and c.order_id=d.order_id) then
   insert into public.public_order_push_events(order_id,event_key,title,body)
   values(d.order_id,'courier_arrived','Seu entregador chegou',
          'O entregador chegou ao endereço. Confira o código de entrega para receber seu pedido.')
   on conflict(order_id,event_key) do nothing;
 end if;
 return pg_catalog.jsonb_build_object('arrived_at',d.arrived_at,'provider_state',v_state);
end
$function$;

create or replace function public.pitacco_driver_verify_own_code(p_delivery uuid,p_code text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare d public.deliveries%rowtype; code_row public.pitacco_own_delivery_codes%rowtype;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão não autorizada' using errcode='42501'; end if;
 if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'Código de seis dígitos inválido' using errcode='22023'; end if;
 select src.* into d from public.deliveries src
  join public.couriers c on c.id=src.courier_id and c.store_id=src.store_id
  where src.id=p_delivery and c.user_id=(select auth.uid()) and c.active and src.source='proprio'
    and src.logistics_provider='loja'
  for update of src;
 if not found or d.status<>'retirada' or d.arrived_at is null then
  raise exception 'Registre primeiro a chegada ao cliente' using errcode='42501'; end if;
 select * into code_row from public.pitacco_own_delivery_codes
  where delivery_id=d.id and store_id=d.store_id for update;
 if not found then raise exception 'Código ainda não gerado' using errcode='22023'; end if;
 if code_row.attempts>=5 then raise exception 'Tentativas esgotadas; solicite ajuda à loja' using errcode='22023'; end if;
 if code_row.code<>p_code then
  update public.pitacco_own_delivery_codes set attempts=attempts+1 where delivery_id=d.id;
  -- Return a negative result rather than raising, so the attempt increment commits.
  return pg_catalog.jsonb_build_object('verified',false,'remaining',4-code_row.attempts);
 end if;
 update public.deliveries set delivery_code_verified_at=pg_catalog.now(),
  status='entregue', updated_at=pg_catalog.now() where id=d.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
  values(d.store_id,d.order_id,(select auth.uid()),'courier_delivery_verified',
   pg_catalog.jsonb_build_object('delivery',d.id,'mode','pitacco_customer_code'));
 return pg_catalog.jsonb_build_object('verified',true,'delivered',true);
end $function$;

create or replace function public.pitacco_driver_ifood_action(p_delivery uuid,p_action text)
returns jsonb language plpgsql stable security definer set search_path to ''
as $fn$
declare
 d public.deliveries%rowtype;
 v_external uuid;
 v_merchant uuid;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão não autorizada' using errcode='42501'; end if;
 if p_action not in ('arrival','verify') then raise exception 'Ação inválida' using errcode='22023';end if;
 select src.* into d from public.deliveries src
 join public.couriers c on c.id=src.courier_id and c.store_id=src.store_id
 where src.id=p_delivery and c.user_id=(select auth.uid()) and c.active
   and src.source='ifood' and src.logistics_provider='loja'
   and src.status='retirada' and src.arrived_at is not null;
 if not found then raise exception 'Entrega iFood não atribuída ou ainda não chegada' using errcode='42501'; end if;
 if p_action='arrival' and d.arrival_provider_state in ('submitted','confirmed') then
   return pg_catalog.jsonb_build_object('already',true,'state',d.arrival_provider_state);
 end if;
 if p_action='verify' and d.arrival_provider_state not in ('submitted','confirmed') then
   raise exception 'Aguarde envio da chegada ao iFood antes do código' using errcode='22023'; end if;
 select l.external_id,m.merchant_id into v_external,v_merchant
 from pitacco_private.ifood_order_links l
 join pitacco_private.ifood_merchants m on m.merchant_id=l.merchant_id
 where l.order_id=d.order_id and m.store_id=d.store_id and m.enabled;
 if v_external is null or v_merchant is null then
   raise exception 'Conexão logística iFood não homologada para esta loja' using errcode='22023'; end if;
 return pg_catalog.jsonb_build_object('already',false,'external_order_id',v_external,'merchant_id',v_merchant);
end $fn$;

create or replace function public.pitacco_ifood_driver_result(
 p_delivery uuid,p_external uuid,p_action text,p_success boolean,p_permanent boolean default false
)
returns boolean language plpgsql security definer set search_path to ''
as $fn$
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
  update public.deliveries set arrival_provider_state=case
    when p_success then 'submitted'
    when p_permanent then 'unavailable' else 'failed' end
   where id=d.id and arrival_provider_state not in ('submitted','confirmed');
  insert into public.operation_audit(store_id,order_id,action,details)
   values(d.store_id,d.order_id,'ifood_arrival_result',
      pg_catalog.jsonb_build_object('delivery',d.id,'success',p_success,'permanent',p_permanent));
  return true;
 end if;
 if p_action='verify' and p_success and d.status='retirada'
    and d.arrival_provider_state in ('submitted','confirmed') then
  update public.deliveries set delivery_code_verified_at=pg_catalog.now(),
     status='entregue', updated_at=pg_catalog.now() where id=d.id;
  insert into public.operation_audit(store_id,order_id,action,details)
   values(d.store_id,d.order_id,'ifood_code_verified',
      pg_catalog.jsonb_build_object('delivery',d.id,'verified',true));
  return true;
 end if;
 return false;
end $fn$;
