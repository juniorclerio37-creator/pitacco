-- Reconcile the existing production arrival RPC with fresh databases.
CREATE OR REPLACE FUNCTION public.pitacco_driver_arrive(p_delivery uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 join public.couriers c on c.id=src.courier_id and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))
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
revoke all on function public.pitacco_driver_arrive(uuid) from public,anon;
grant execute on function public.pitacco_driver_arrive(uuid) to authenticated,service_role;
