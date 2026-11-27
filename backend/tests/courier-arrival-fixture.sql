-- CI ONLY. Minimal outbox shape used by the original arrival function.
-- No push worker, external calls, or production schema deployment.
create table if not exists public.public_order_push_events(
 order_id uuid not null references public.orders(id),
 event_key text not null,title text not null,body text not null,
 unique(order_id,event_key)
);
revoke all on public.public_order_push_events from public,anon,authenticated;

-- Exact arrival function from docs/sql/20261117-fix-driver-arrival-rpcs.sql.
-- Do not install the older verification or iFood functions from that file.
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
revoke all on function public.pitacco_driver_arrive(uuid) from public,anon;
grant execute on function public.pitacco_driver_arrive(uuid) to authenticated;
-- Synthetic public checkout reference, only for validating the original outbox.
insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,tracking_token)
values('98000000-0000-0000-0000-000000000011','20000000-0000-4000-8000-000000000001',gen_random_uuid(),'{"fulfillment":"delivery","customer":"Cliente Fixture"}','21988888183',gen_random_uuid());
