-- Pitacco merchant order transitions: local preparation is separate from marketplace's
-- official delivery state. Selecting a courier requires that the kitchen marks
-- the linked order READY; accepting a pedido never dispatches it.
CREATE OR REPLACE FUNCTION public.set_order_preparation(p_order uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.is_store_manager(o.store_id) then raise exception 'Sem permissao';end if;
 if o.status<>'accepted' then raise exception 'Somente pedidos aceitos podem avançar no preparo';end if;
 if p_status is null or p_status not in ('ready','completed') then raise exception 'Etapa invalida';end if;
 if o.preparation_status=p_status then return;end if;
 if exists(select 1 from public.deliveries where order_id=o.id and status in ('retirada','entregue','cancelada')) then raise exception 'Pedido ja encaminhado para entrega';end if;
 if not ((o.preparation_status='preparing' and p_status='ready') or
          (o.preparation_status='ready' and p_status='completed' and o.source='proprio'
           and o.receipt->>'logistics'='retirada')) then raise exception 'Transição de preparo inválida';end if;
 update public.orders set preparation_status=p_status where id=o.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(o.store_id,o.id,auth.uid(),'preparation_changed',jsonb_build_object('from',o.preparation_status,'to',p_status));
end $function$;

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
 if not (public.can_access_store(s) or coalesce(auth.jwt()->>'role','') = 'service_role') then raise exception 'Sem permissão para atribuir entregador'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into cr from public.couriers where id=c for update;
 if not found or not cr.active then raise exception 'Entregador indisponível';end if;
 if (cr.fleet_type='propria' and cr.store_id<>s and not public.pitacco_courier_test_access(c,s)) or (cr.fleet_type='compartilhada' and (automatic or not public.is_admin())) then raise exception 'Entregador não autorizado';end if;
 select max_orders_per_trip,delivery_mode into cap,mode from public.stores where id=s;
 if (cr.fleet_type='propria' and mode not in ('propria','ambas')) or (cr.fleet_type='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Frota não habilitada';end if;
 select * into rec from public.deliveries where id=d for update;
 if rec.logistics_provider<>'loja' then raise exception 'Entrega já pertence à plataforma';end if;
 if rec.order_id is not null then
   perform 1 from public.orders o
   where o.id=rec.order_id and o.store_id=s and o.status='accepted'
     and o.preparation_status='ready'
   for share;
   if not found then
     raise exception 'Marque o pedido como pronto antes de selecionar o entregador ou despachar';
   end if;
 end if;
 if rec.courier_id=c and rec.batch_id is not null then return rec.batch_id;end if;
 if rec.status<>'pendente' or rec.courier_id is not null or rec.batch_id is not null then raise exception 'Entrega já atribuída ou encerrada';end if;
 if exists(select 1 from public.deliveries x left join public.delivery_batches r on r.id=x.batch_id where x.courier_id=c and x.status not in ('entregue','cancelada') and (x.batch_id is null or r.departed_at is not null or r.store_id<>s)) then raise exception 'Entregador ocupado: rota já saiu ou viagem anterior aberta';end if;
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
     where x.batch_id=r.id and x.status not in ('entregue','cancelada')
   )
 order by r.created_at desc limit 1 for update;
 if b is not null then
  if (select departed_at is not null from public.delivery_batches where id=b) then raise exception 'Rota já saiu da loja';end if;
  if not confirmed then raise exception 'Confirme o possível desvio antes de agrupar manualmente';end if;
  if (select count(*) from public.deliveries where batch_id=b and status<>'cancelada')>=cap then raise exception 'Limite de pedidos por rota atingido';end if;
 else
  insert into public.delivery_batches(store_id,courier_id,created_by) values(s,c,coalesce(auth.uid(),cr.user_id)) returning id into b;
 end if;
 if automatic and (not cr.available or not exists(select 1 from public.courier_positions where courier_id=c and observed_at>now()-interval '90 seconds')) then raise exception 'Entregador offline ou GPS desatualizado';end if;
 update public.deliveries set courier_id=c,batch_id=b,status='atribuida',updated_at=now() where id=d;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(s,rec.order_id,auth.uid(),case when automatic then 'route_auto_assigned' else 'route_manual_assigned' end,jsonb_build_object('delivery',d,'courier',c,'route',b,'deviation_confirmed',confirmed));
 return b;
end$function$;
