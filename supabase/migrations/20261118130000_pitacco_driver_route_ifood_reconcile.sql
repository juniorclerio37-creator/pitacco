-- Rota agrupada: compartilhar somente a localização da loja de lotes atribuídos.
-- Não expor coordenadas de outras lojas nem dados do cliente.
create or replace function public.pitacco_driver_route_origins()
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare v_result jsonb;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'store_id', s.id,'latitude',s.latitude,'longitude',s.longitude
  )), '[]'::jsonb)
 into v_result
 from public.stores s
 where exists(
   select 1 from public.deliveries d
   join public.couriers c on c.id=d.courier_id and c.active
      and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))
   where d.store_id=s.id and c.user_id=(select auth.uid())
     and d.batch_id is not null and d.status in ('aceita','retirada')
     and d.logistics_provider='loja'
 );
 return v_result;
end $$;
revoke all on function public.pitacco_driver_route_origins() from public,anon;
grant execute on function public.pitacco_driver_route_origins() to authenticated;

-- Reconciliação pós-link: somente evento CONCLUDED oficial pode fechar
-- uma entrega iFood chegada ao destino, já atribuída ao próprio entregador.
-- O evento não prova qual PIN foi digitado; não registrar PIN como validado.
create or replace function public.pitacco_driver_reconcile_ifood(p_delivery uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
 d public.deliveries%rowtype;
 v_status text;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select src.* into d from public.deliveries src
 join public.couriers c on c.id=src.courier_id and c.active
   and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))
 where src.id=p_delivery and c.user_id=(select auth.uid())
   and src.logistics_provider='loja' and src.source='ifood'
 for update of src;
 if not found then raise exception 'Entrega não autorizada' using errcode='42501'; end if;
 if d.status='entregue' then
   return pg_catalog.jsonb_build_object('confirmed',true,'already',true);
 end if;
 if d.status<>'retirada' or d.arrived_at is null then
   raise exception 'Registre a chegada antes da confirmação' using errcode='22023';
 end if;
 select o.receipt->>'ifood_status' into v_status
 from public.orders o
 where o.id=d.order_id and o.store_id=d.store_id and o.source='ifood';
 -- Double proof: only a processed iFood CONCLUDED event from the private
 -- verified event queue for this linked merchant/order may complete externally.
 if v_status is distinct from 'CONCLUDED' or not exists(
   select 1 from pitacco_private.ifood_order_links l
   join pitacco_private.ifood_events e
      on e.order_id=l.external_id and e.merchant_id=l.merchant_id
   where l.order_id=d.order_id and e.code='CONCLUDED'
     and e.done_at is not null and e.event_at>=d.arrived_at
 ) then
   return pg_catalog.jsonb_build_object('confirmed',false,'pending',true);
 end if;
 update public.deliveries set status='entregue',updated_at=pg_catalog.now()
 where id=d.id and status='retirada';
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(d.store_id,d.order_id,(select auth.uid()),'ifood_external_delivery_reconciled',
   pg_catalog.jsonb_build_object('delivery',d.id,'provider_event','CONCLUDED'));
 return pg_catalog.jsonb_build_object('confirmed',true,'already',false);
end $$;
revoke all on function public.pitacco_driver_reconcile_ifood(uuid) from public,anon;
grant execute on function public.pitacco_driver_reconcile_ifood(uuid) to authenticated;
notify pgrst,'reload schema';

-- Delivery owned by the store is verified with the Order API. This API does
-- not require the separate Logistics "arrivedAtDestination" handshake.
-- Keep the local arrival and ownership checks; only remove that extra gate.
do $patch$
declare
 v_oid oid;
 v_body text;
 v_old text;
begin
 v_oid:=pg_catalog.to_regprocedure('public.pitacco_driver_ifood_action(uuid,text)');
 if v_oid is null then
   raise notice 'Autorização iFood ausente no fixture isolado; ajuste será aplicado no ambiente existente';
 else
 v_body:=pg_catalog.pg_get_functiondef(v_oid);
 v_old:=$needle$ if p_action='verify' and d.arrival_provider_state not in ('submitted','confirmed') then
   raise exception 'Aguarde envio da chegada ao iFood antes do código' using errcode='22023'; end if;
$needle$;
 if pg_catalog.strpos(v_body,v_old)=0 then
   raise exception 'Guard de chegada iFood diferente do esperado; abortando alteração segura';
 end if;
 execute pg_catalog.replace(v_body,v_old,'');
 end if;
 v_oid:=pg_catalog.to_regprocedure('public.pitacco_ifood_driver_result(uuid,uuid,text,boolean,boolean)');
 if v_oid is null then
   raise notice 'Resultado iFood ausente no fixture isolado; ajuste será aplicado no ambiente existente';
 else
 v_body:=pg_catalog.pg_get_functiondef(v_oid);
 v_old:=$needle$if p_action='verify' and p_success and d.status='retirada'
    and d.arrival_provider_state in ('submitted','confirmed') then$needle$;
 if pg_catalog.strpos(v_body,v_old)=0 then
   raise exception 'Guard de resultado iFood diferente do esperado; abortando alteração segura';
 end if;
 execute pg_catalog.replace(v_body,v_old,
   $needle$if p_action='verify' and p_success and d.status='retirada' then$needle$);
 end if;
end
$patch$;
