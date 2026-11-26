
alter table public.deliveries add column if not exists manual_dispatch_hold boolean not null default false;
do $patch$ declare f text; begin
 select pg_get_functiondef('public.dg_assign_route(uuid,uuid,boolean,boolean)'::regprocedure) into f;
 if strpos(f,'if rec.courier_id=c and rec.batch_id is not null then')=0 then raise exception 'dispatch anchor missing';end if;
 f:=replace(f,'if rec.courier_id=c and rec.batch_id is not null then','if automatic and rec.manual_dispatch_hold then raise exception ''Alocação automática pausada neste pedido'';end if; if rec.courier_id=c and rec.batch_id is not null then');
 f:=replace(f,'set courier_id=c,batch_id=b,status=''atribuida'',updated_at=now()','set courier_id=c,batch_id=b,status=''atribuida'',manual_dispatch_hold=false,updated_at=now()');
 execute f;
 select pg_get_functiondef('pitacco_private.group_auto_one(uuid)'::regprocedure) into f;
 f:=replace(f,'where d.store_id=s and d.status=''pendente''','where d.store_id=s and not d.manual_dispatch_hold and d.status=''pendente''');
 execute f;
end $patch$;
create or replace function public.pitacco_manage_own_delivery(p_delivery uuid,p_expected_courier uuid,p_new_courier uuid,p_action text,p_confirm_deviation boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.deliveries%rowtype; s uuid; old_batch uuid; result uuid;
begin
 select store_id into s from public.deliveries where id=p_delivery;
 if s is null or auth.uid() is null or not public.is_store_manager(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into d from public.deliveries where id=p_delivery and store_id=s for update;
 if not found or d.logistics_provider<>'loja' or d.order_id is null or d.courier_id is distinct from p_expected_courier or d.status not in ('pendente','atribuida','aceita') or d.collected_at is not null or d.capacity_released_at is not null or coalesce(d.external_delivery_status,'') in ('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN') then raise exception 'Entrega mudou de situação ou não pode ser alterada';end if;
 if not exists(select 1 from public.orders o where o.id=d.order_id and o.store_id=s and o.status='accepted' and o.preparation_status='ready') then raise exception 'Pedido não está pronto';end if;
 if d.batch_id is not null and not exists(select 1 from public.delivery_batches b where b.id=d.batch_id and b.store_id=s and b.departed_at is null and b.completed_at is null) then raise exception 'Rota já saiu da loja';end if;
 if p_action='resume' then
  if d.courier_id is not null or d.batch_id is not null or d.status<>'pendente' then raise exception 'Entrega já atribuída';end if;
  update public.deliveries set manual_dispatch_hold=false,updated_at=now() where id=d.id;
 elsif p_action in ('remove','reassign') then
  if d.courier_id is null then raise exception 'Não há entregador para remover';end if;
  if p_action='reassign' and (p_new_courier is null or p_new_courier=d.courier_id or not exists(select 1 from public.couriers c where c.id=p_new_courier and c.fleet_type='propria' and c.active and c.available and (c.store_id=s or public.pitacco_courier_test_access(c.id,s)))) then raise exception 'Selecione outro entregador próprio disponível';end if;
  old_batch:=d.batch_id;
  update public.deliveries set courier_id=null,batch_id=null,status='pendente',manual_dispatch_hold=true,updated_at=now() where id=d.id;
  if old_batch is not null then
   update public.delivery_batches b set completed_at=now() where b.id=old_batch and b.completed_at is null and not exists(select 1 from public.deliveries x where x.batch_id=b.id and x.status not in ('entregue','cancelada') and x.capacity_released_at is null);
  end if;
  if p_action='reassign' then result:=public.dg_assign_route(d.id,p_new_courier,p_confirm_deviation,false);end if;
 else raise exception 'Ação logística inválida';end if;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(s,d.order_id,auth.uid(),'own_delivery_'||p_action,jsonb_build_object('delivery',d.id,'previous_courier',d.courier_id,'previous_route',d.batch_id,'new_courier',p_new_courier,'new_route',result));
 return result;
end $$;
revoke all on function public.pitacco_manage_own_delivery(uuid,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.pitacco_manage_own_delivery(uuid,uuid,uuid,text,boolean) to authenticated;

