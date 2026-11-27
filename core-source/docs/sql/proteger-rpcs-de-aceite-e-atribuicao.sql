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
 if (cr.fleet_type='propria' and cr.store_id<>s) or (cr.fleet_type='compartilhada' and (automatic or not public.is_admin())) then raise exception 'Entregador não autorizado';end if;
 select max_orders_per_trip,delivery_mode into cap,mode from public.stores where id=s;
 if (cr.fleet_type='propria' and mode not in ('propria','ambas')) or (cr.fleet_type='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Frota não habilitada';end if;
 select * into rec from public.deliveries where id=d for update;
 if rec.logistics_provider<>'loja' then raise exception 'Entrega já pertence à plataforma';end if;
 if rec.courier_id=c and rec.batch_id is not null then return rec.batch_id;end if;
 if rec.status<>'pendente' or rec.courier_id is not null or rec.batch_id is not null then raise exception 'Entrega já atribuída ou encerrada';end if;
 if exists(select 1 from public.deliveries x left join public.delivery_batches r on r.id=x.batch_id where x.courier_id=c and x.status not in ('entregue','cancelada') and (x.batch_id is null or r.departed_at is not null or r.store_id<>s)) then raise exception 'Entregador ocupado: rota já saiu ou viagem anterior aberta';end if;
 select id into b from public.delivery_batches where courier_id=c and store_id=s and completed_at is null order by created_at limit 1 for update;
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
end$function$
;

CREATE OR REPLACE FUNCTION public.dg_accept_own(p_order uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; r jsonb;
begin
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'Pedido inexistente'; end if;
 if not (public.can_access_store(o.store_id) or coalesce(auth.jwt()->>'role','') = 'service_role') then raise exception 'Sem permissão para aceitar o pedido'; end if;
 if o.source <> 'proprio' then raise exception 'Aceite bloqueado: integracao oficial ainda nao configurada'; end if;
 if o.status='accepted' then return o.id; end if;
 if o.status <> 'pending' or o.receipt is null then raise exception 'Pedido nao elegivel para aceite'; end if;
 r := o.receipt || jsonb_build_object('number',o.id,'source',o.source,'accepted_at',now());
 update public.orders set status='accepted',accepted_at=now(),accepted_by=auth.uid(),receipt=r where id=o.id;
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,receipt,receipt_text)
 select o.store_id,o.id,s.sector,s.printer,s.width,n,r,
  public.dg_receipt_text(r) || 'Setor: ' || public.dg_clean_text(s.sector) || ' Via: ' || n || chr(10)
 from public.print_sectors s cross join lateral generate_series(1,s.copies) n
 where s.store_id=o.store_id and s.enabled
 on conflict(order_id,sector,copy_no,request_id) do nothing;
 if r->>'logistics'='loja' then
  insert into public.deliveries(store_id,order_id,source,logistics_provider,customer_name,address,notes)
  values(o.store_id,o.id,'proprio','loja',r->>'customer',r->>'address',r->>'notes')
  on conflict(order_id) where order_id is not null do nothing;
 end if;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(o.store_id,o.id,auth.uid(),'accepted',jsonb_build_object('source','proprio','print_jobs',(select count(*) from public.print_jobs where order_id=o.id)));
 return o.id;
end$function$
;

revoke all on function public.dg_assign_route(uuid,uuid,boolean,boolean) from public,anon;
revoke all on function public.dg_accept_own(uuid) from public,anon;
grant execute on function public.dg_assign_route(uuid,uuid,boolean,boolean) to authenticated,service_role;
grant execute on function public.dg_accept_own(uuid) to authenticated,service_role;
