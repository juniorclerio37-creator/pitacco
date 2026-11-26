-- Manual route decisions may override automatic target capacity and urgency; keep readiness, tenant isolation, partner ownership and departure safeguards.
CREATE OR REPLACE FUNCTION public.dg_assign_route(d uuid, c uuid, confirmed boolean, automatic boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rec public.deliveries%rowtype; cr public.couriers%rowtype; b uuid; cap integer; s uuid; mode text;
begin
 select store_id into s from public.deliveries where id=d;
 if s is null then raise exception 'Entrega inexistente';end if;
 if not (public.can_access_store(s) or coalesce(auth.jwt()->>'role','') = 'service_role' or (automatic and auth.uid() is null)) then raise exception 'Sem permissão para atribuir entregador'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into cr from public.couriers where id=c for update;
 if not found or not cr.active then raise exception 'Entregador indisponível';end if;
 if (cr.fleet_type='propria' and cr.store_id<>s and not public.pitacco_courier_test_access(c,s)) or (cr.fleet_type='compartilhada' and (automatic or not public.is_admin())) then raise exception 'Entregador não autorizado';end if;
 select max_orders_per_trip,delivery_mode into cap,mode from public.stores where id=s;
 if (cr.fleet_type='propria' and mode not in ('propria','ambas')) or (cr.fleet_type='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Frota não habilitada';end if;
 select * into rec from public.deliveries where id=d for update;
 if coalesce(rec.external_delivery_status,'') in ('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN') then raise exception 'Entrega parceira em solicitação';end if; if rec.logistics_provider<>'loja' then raise exception 'Entrega já pertence à plataforma';end if;
 if rec.order_id is not null then
   perform 1 from public.orders o
   where o.id=rec.order_id and o.store_id=s and o.status='accepted'
     and o.preparation_status='ready'
   for share;
   if not found then
     raise exception 'Marque o pedido como pronto antes de selecionar o entregador ou despachar';
   end if;
 end if;
 if automatic and rec.manual_dispatch_hold then raise exception 'Alocação automática pausada neste pedido';end if; if rec.courier_id=c and rec.batch_id is not null then return rec.batch_id;end if;
 if rec.status<>'pendente' or rec.courier_id is not null or rec.batch_id is not null then raise exception 'Entrega já atribuída ou encerrada';end if;
 if exists(select 1 from public.deliveries x left join public.delivery_batches r on r.id=x.batch_id where x.courier_id=c and x.status not in ('entregue','cancelada') and x.capacity_released_at is null and (x.batch_id is null or r.departed_at is not null or r.store_id<>s)) then raise exception 'Entregador ocupado: rota já saiu ou viagem anterior aberta';end if;
 update public.delivery_batches r
     set completed_at=now()
   where r.courier_id=c and r.completed_at is null
     and not exists (
       select 1 from public.deliveries x
       where x.batch_id=r.id and x.status not in ('entregue','cancelada')
     );
 select r.id into b from public.delivery_batches r
 where r.courier_id=c and r.store_id=s and r.completed_at is null and r.departed_at is null
   and exists (
     select 1 from public.deliveries x
     where x.batch_id=r.id and x.status not in ('entregue','cancelada') and x.capacity_released_at is null
   )
 order by r.created_at desc limit 1 for update;
 if b is not null then
  if automatic and (pitacco_private.delivery_urgency(rec.delivery_service,rec.deliver_by,now())<=2 or exists(select 1 from public.deliveries x where x.batch_id=b and x.status not in ('entregue','cancelada') and x.capacity_released_at is null and pitacco_private.delivery_urgency(x.delivery_service,x.deliver_by,now())<=2)) then raise exception 'Pedido prioritário ou atrasado precisa de viagem exclusiva';end if;
  if (select departed_at is not null from public.delivery_batches where id=b) then raise exception 'Rota já saiu da loja';end if;
  if not confirmed then raise exception 'Confirme a inclusão manual e confira a capacidade e os prazos da rota';end if;
  if automatic and (select count(*) from public.deliveries where batch_id=b and status not in ('entregue','cancelada') and capacity_released_at is null)>=cap then raise exception 'Limite de pedidos por rota atingido';end if;
 else
  insert into public.delivery_batches(store_id,courier_id,created_by) values(s,c,coalesce(auth.uid(),cr.user_id)) returning id into b;
 end if;
 if automatic and (not cr.available or not exists(select 1 from public.courier_positions where courier_id=c and observed_at>now()-interval '90 seconds')) then raise exception 'Entregador offline ou GPS desatualizado';end if;
 update public.deliveries set courier_id=c,batch_id=b,status='atribuida',manual_dispatch_hold=false,updated_at=now() where id=d;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(s,rec.order_id,auth.uid(),case when automatic then 'route_auto_assigned' else 'route_manual_assigned' end,jsonb_build_object('delivery',d,'courier',c,'route',b,'deviation_confirmed',confirmed,'manual_override',not automatic,'configured_capacity',cap,'route_load',(select count(*) from public.deliveries x where x.batch_id=b and x.status not in ('entregue','cancelada') and x.capacity_released_at is null)));
 return b;
end$function$;
CREATE OR REPLACE FUNCTION public.assign_delivery_batch(s uuid, courier uuid, delivery_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x uuid; r uuid; cr public.couriers%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(s) then raise exception 'Sem permissão' using errcode='42501'; end if;
 if delivery_ids is null or cardinality(delivery_ids)<2 or cardinality(delivery_ids)>15 or cardinality(delivery_ids)<>(select count(distinct u) from unnest(delivery_ids) u) then raise exception 'Selecione de 2 a 15 pedidos distintos';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into cr from public.couriers where id=courier for update;
 if not found or not cr.active or not cr.available or cr.fleet_type<>'propria' or (cr.store_id<>s and not public.pitacco_courier_test_access(courier,s)) or not exists(select 1 from public.courier_positions p where p.courier_id=courier and p.observed_at between now()-interval '90 seconds' and now()+interval '5 seconds') then raise exception 'Entregador indisponível ou sem GPS recente';end if;
 -- Explicit manual batch selection may exceed the automatic target; all orders count individually.
 foreach x in array delivery_ids loop
  if not exists(select 1 from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.id=x and d.store_id=s and d.logistics_provider='loja' and d.capacity_released_at is null and d.status='pendente' and d.courier_id is null and d.batch_id is null and o.status='accepted' and o.preparation_status='ready') then raise exception 'Um pedido não está mais pronto para agrupamento';end if;
  r:=public.dg_assign_route(x,courier,true,false);
 end loop;
 return r;
end $function$;
