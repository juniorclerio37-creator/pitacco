-- Operational exceptions do not cancel orders or erase earnings.
alter table public.deliveries add column if not exists capacity_released_at timestamptz;
create table public.pitacco_delivery_incidents(
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null references public.deliveries(id),
 store_id uuid not null references public.stores(id),
 order_id uuid references public.orders(id),
 courier_id uuid not null references public.couriers(id),
 kind text not null check(kind in ('customer_missing','wrong_address','payment','customer_refused','code','vehicle','system_error','other')),
 state text not null default 'open' check(state in ('open','acknowledged','resolved','cancelled')),
 created_at timestamptz not null default now(),
 acknowledged_at timestamptz, resolved_at timestamptz,
 latitude double precision, longitude double precision,
 actor uuid not null
);
create unique index pitacco_one_live_incident_per_kind on public.pitacco_delivery_incidents(delivery_id,kind) where state in ('open','acknowledged');
create index pitacco_incidents_store_time on public.pitacco_delivery_incidents(store_id,created_at desc);
alter table public.pitacco_delivery_incidents enable row level security;
revoke all on public.pitacco_delivery_incidents from public,anon,authenticated;
grant select on public.pitacco_delivery_incidents to authenticated;
create policy pitacco_incidents_read on public.pitacco_delivery_incidents for select to authenticated using (
 public.is_store_manager(store_id) or
 (public.pitacco_courier_session_ready() and exists(select 1 from public.couriers c where c.id=courier_id and c.user_id=(select auth.uid()) and c.active)));
create or replace function public.pitacco_report_delivery_incident(p_delivery uuid,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.deliveries%rowtype; i uuid; pos public.courier_positions%rowtype;
begin
 if auth.uid() is null or not public.pitacco_courier_session_ready() then raise exception 'Sessão do entregador inválida' using errcode='42501';end if;
 select src.* into d from public.deliveries src join public.couriers c on c.id=src.courier_id
 where src.id=p_delivery and c.active and c.user_id=auth.uid() and src.logistics_provider='loja' and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id)) for update of src;
 if not found then raise exception 'Entrega não atribuída' using errcode='42501';end if;
 if d.status not in ('atribuida','aceita','retirada') then raise exception 'Entrega não está ativa';end if;
 if p_kind='customer_missing' and (d.status<>'retirada' or d.arrived_at is null) then raise exception 'Registre primeiro a chegada';end if;
 if p_kind is null or p_kind not in ('customer_missing','wrong_address','payment','customer_refused','code','vehicle','system_error','other') then raise exception 'Ocorrência inválida';end if;
 select id into i from public.pitacco_delivery_incidents where delivery_id=d.id and kind=p_kind and state in ('open','acknowledged');
 if found then return i;end if;
 select * into pos from public.courier_positions where courier_id=d.courier_id and observed_at>now()-interval '2 minutes';
 insert into public.pitacco_delivery_incidents(delivery_id,store_id,order_id,courier_id,kind,actor,latitude,longitude)
 values(d.id,d.store_id,d.order_id,d.courier_id,p_kind,auth.uid(),pos.latitude,pos.longitude) returning id into i;
 -- A parked/problematic stop is excluded from future route capacity. No status or payment is changed.
 update public.deliveries set capacity_released_at=coalesce(capacity_released_at,now()) where id=d.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(d.store_id,d.order_id,auth.uid(),'delivery_incident_reported',jsonb_build_object('incident',i,'delivery',d.id,'kind',p_kind));
 return i;
end $$;
revoke all on function public.pitacco_report_delivery_incident(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_report_delivery_incident(uuid,text) to authenticated;
create or replace function public.pitacco_update_delivery_incident(p_incident uuid,p_state text)
returns void language plpgsql security definer set search_path='' as $$
declare i public.pitacco_delivery_incidents%rowtype; d public.deliveries%rowtype; manager boolean; courier boolean;
begin
 if auth.uid() is null or p_state is null or p_state not in ('acknowledged','resolved') then raise exception 'Ação inválida';end if;
 select * into i from public.pitacco_delivery_incidents where id=p_incident;
 if not found then raise exception 'Ocorrência indisponível';end if;
 select * into d from public.deliveries where id=i.delivery_id for update;
 select * into i from public.pitacco_delivery_incidents where id=p_incident for update;
 manager:=public.is_store_manager(i.store_id);
 courier:=public.pitacco_courier_session_ready() and exists(select 1 from public.couriers c where c.id=i.courier_id and c.id=d.courier_id and c.user_id=auth.uid() and c.active);
 if not (manager or (courier and p_state='resolved')) then raise exception 'Sem permissão' using errcode='42501';end if;
 if i.state=p_state then return;end if;
 if i.state not in ('open','acknowledged') or (i.state='acknowledged' and p_state='acknowledged') then raise exception 'Ocorrência encerrada';end if;
 update public.pitacco_delivery_incidents set state=p_state,acknowledged_at=case when p_state='acknowledged' then now() else acknowledged_at end,resolved_at=case when p_state='resolved' then now() else resolved_at end where id=i.id;
 -- Do not re-lock the courier's current work on resolution; released stops keep their original delivery history.
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(i.store_id,i.order_id,auth.uid(),'delivery_incident_'||p_state,jsonb_build_object('incident',i.id,'delivery',i.delivery_id));
end $$;
revoke all on function public.pitacco_update_delivery_incident(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_update_delivery_incident(uuid,text) to authenticated;
create or replace function public.pitacco_release_delivery_capacity(p_delivery uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare d public.deliveries%rowtype; reason text:=public.dg_clean_text(btrim(coalesce(p_reason,'')));
begin
 if auth.uid() is null or char_length(reason) not between 3 and 240 then raise exception 'Informe o motivo';end if;
 select * into d from public.deliveries where id=p_delivery and public.is_store_manager(store_id) for update;
 if not found then raise exception 'Sem permissão' using errcode='42501';end if;
 if d.courier_id is null or d.status in ('entregue','cancelada') then raise exception 'Entrega não está ativa e alocada';end if;
 if d.capacity_released_at is not null then return;end if;
 update public.deliveries set capacity_released_at=now() where id=d.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(d.store_id,d.order_id,auth.uid(),'delivery_capacity_released',jsonb_build_object('delivery',d.id,'reason',reason));
end $$;
revoke all on function public.pitacco_release_delivery_capacity(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_release_delivery_capacity(uuid,text) to authenticated;
create or replace function pitacco_private.close_incident_on_terminal_delivery()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('entregue','cancelada') and new.status is distinct from old.status then
 update public.pitacco_delivery_incidents set state=case when new.status='cancelada' then 'cancelled' else 'resolved' end,resolved_at=now()
 where delivery_id=new.id and state in ('open','acknowledged');
 end if;return new;
end $$;
revoke all on function pitacco_private.close_incident_on_terminal_delivery() from public,anon,authenticated;
create trigger pitacco_close_incident_on_terminal_delivery after update of status on public.deliveries for each row execute function pitacco_private.close_incident_on_terminal_delivery();
-- Only authoritative cancellation status is synchronized; do not rewrite a completed delivery.
create or replace function pitacco_private.sync_marketplace_delivery_cancellation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source in ('ifood','99food','keeta') and new.status='cancelled' and old.status is distinct from new.status and
 (new.source<>'ifood' or new.receipt->>'ifood_status'='CANCELLED') then
 update public.deliveries set status='cancelada',updated_at=now()
 where order_id=new.id and store_id=new.store_id and status not in ('entregue','cancelada');
 insert into public.operation_audit(store_id,order_id,action,details) values(new.store_id,new.id,'marketplace_cancelled_synced',
 jsonb_build_object('source',new.source,'reason',coalesce(new.receipt->'cancellation_reason',new.receipt->'cancel_reason',new.receipt->'ifood_manual_cancel_reason'),'provider_status',new.receipt->>'ifood_status'));
 end if;return new;
end $$;
revoke all on function pitacco_private.sync_marketplace_delivery_cancellation() from public,anon,authenticated;
create trigger pitacco_sync_marketplace_delivery_cancellation after update of status on public.orders for each row execute function pitacco_private.sync_marketplace_delivery_cancellation();

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
  if (select departed_at is not null from public.delivery_batches where id=b) then raise exception 'Rota já saiu da loja';end if;
  if not confirmed then raise exception 'Confirme o possível desvio antes de agrupar manualmente';end if;
  if (select count(*) from public.deliveries where batch_id=b and status not in ('entregue','cancelada') and capacity_released_at is null)>=cap then raise exception 'Limite de pedidos por rota atingido';end if;
 else
  insert into public.delivery_batches(store_id,courier_id,created_by) values(s,c,coalesce(auth.uid(),cr.user_id)) returning id into b;
 end if;
 if automatic and (not cr.available or not exists(select 1 from public.courier_positions where courier_id=c and observed_at>now()-interval '90 seconds')) then raise exception 'Entregador offline ou GPS desatualizado';end if;
 update public.deliveries set courier_id=c,batch_id=b,status='atribuida',updated_at=now() where id=d;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(s,rec.order_id,auth.uid(),case when automatic then 'route_auto_assigned' else 'route_manual_assigned' end,jsonb_build_object('delivery',d,'courier',c,'route',b,'deviation_confirmed',confirmed));
 return b;
end$function$;

CREATE OR REPLACE FUNCTION public.dispatch_candidates()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x record; token uuid; snap jsonb; result jsonb:='[]';begin
 delete from public.dispatch_checks where created_at<now()-interval '10 minutes';
 for x in select s.id s,d.id d,c.id c from public.stores s join public.deliveries d on d.store_id=s.id join public.couriers c on c.store_id=s.id join public.courier_positions p on p.courier_id=c.id
 where s.dispatch_mode in ('automatico','misto') and s.delivery_mode in ('propria','ambas') and s.latitude is not null and s.longitude is not null and d.status='pendente' and d.courier_id is null and d.logistics_provider='loja' and d.latitude is not null and d.longitude is not null and d.deliver_by>now() and c.active and c.available and c.fleet_type='propria' and p.observed_at>now()-interval '90 seconds'
 and not exists(select 1 from public.deliveries a left join public.delivery_batches b on b.id=a.batch_id where a.courier_id=c.id and a.status not in ('entregue','cancelada') and a.capacity_released_at is null and (b.id is null or b.departed_at is not null)) order by d.created_at,d.id,c.id limit 100 loop
 snap:=public.dg_dispatch_snapshot(x.s,x.d,x.c);
 insert into public.dispatch_checks(store_id,delivery_id,courier_id,snapshot) values(x.s,x.d,x.c,snap) returning id into token;
 result:=result||jsonb_build_array(jsonb_build_object('token',token,'data',snap));
 end loop;return result;
end$function$;

CREATE OR REPLACE FUNCTION public.dg_dispatch_snapshot(s uuid, d uuid, c uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('store',(select to_jsonb(x) from (select id,latitude,longitude,max_orders_per_trip,dispatch_mode from public.stores where id=s)x),'delivery',(select to_jsonb(x) from (select id,latitude,longitude,deliver_by,status,courier_id,batch_id,logistics_provider,updated_at from public.deliveries where id=d)x),'courier',(select to_jsonb(x) from (select id,active,available,fleet_type,store_id from public.couriers where id=c)x),'gps',(select to_jsonb(x) from public.courier_positions x where courier_id=c),'stops',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select a.id,a.latitude,a.longitude,a.deliver_by,a.status,a.batch_id,a.updated_at,b.departed_at from public.deliveries a left join public.delivery_batches b on a.batch_id=b.id where a.courier_id=c and a.status not in ('entregue','cancelada') and a.capacity_released_at is null)x),'[]'::jsonb))
$function$;
