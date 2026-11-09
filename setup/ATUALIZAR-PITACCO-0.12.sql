-- Execute UMA VEZ no SQL Editor do projeto existente, apos backup.
-- Requer a base Pitacco 0.11 (migracoes ate 011). Nao reinstala o schema.
begin;
alter table public.orders add column if not exists preparation_status text not null default 'preparing' check(preparation_status in ('preparing','ready','completed'));
create or replace function public.set_order_preparation(p_order uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.is_store_manager(o.store_id) then raise exception 'Sem permissao';end if;
 if o.status<>'accepted' or o.source<>'proprio' then raise exception 'Somente pedidos proprios aceitos podem avancar';end if;
 if p_status is null or p_status not in ('ready','completed') then raise exception 'Etapa invalida';end if;
 if o.preparation_status=p_status then return;end if;
 if exists(select 1 from public.deliveries where order_id=o.id and status in ('retirada','entregue','cancelada')) then raise exception 'Pedido ja encaminhado para entrega';end if;
 if not ((o.preparation_status='preparing' and p_status='ready') or (o.preparation_status='ready' and p_status='completed' and o.receipt->>'logistics'='retirada')) then raise exception 'Transicao invalida';end if;
 update public.orders set preparation_status=p_status where id=o.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(o.store_id,o.id,auth.uid(),'preparation_changed',jsonb_build_object('from',o.preparation_status,'to',p_status));
end $$;
revoke all on function public.set_order_preparation(uuid,text) from public,anon,authenticated;
grant execute on function public.set_order_preparation(uuid,text) to authenticated;
commit;
-- Incremental migration, after 012. Existing deliveries and financial records preserved.
begin;
alter table public.delivery_batches add column if not exists departed_at timestamptz;
alter table public.delivery_batches add column if not exists completed_at timestamptz;
alter table public.deliveries add column if not exists collected_at timestamptz;
alter table public.deliveries add column if not exists latitude double precision check(latitude between -90 and 90);
alter table public.deliveries add column if not exists longitude double precision check(longitude between -180 and 180);
alter table public.deliveries add column if not exists deliver_by timestamptz;
alter table public.stores add column if not exists latitude double precision check(latitude between -90 and 90);
alter table public.stores add column if not exists longitude double precision check(longitude between -180 and 180);
create table public.courier_positions(
 courier_id uuid primary key references public.couriers(id),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 accuracy_m double precision not null check(accuracy_m between 0 and 100),
 observed_at timestamptz not null default now()
);
alter table public.courier_positions enable row level security;
revoke all on public.courier_positions from anon,authenticated;
grant select on public.courier_positions to authenticated;
create policy positions_read on public.courier_positions for select to authenticated using(
 public.is_courier(courier_id) or exists(select 1 from public.couriers c where c.id=courier_id and public.is_store_manager(c.store_id)));
-- Heartbeats are authenticated as the courier; the server stamps receipt time.
create function public.courier_heartbeat(lat double precision,lng double precision,accuracy double precision)
returns void language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 select id into cid from public.couriers where user_id=auth.uid() and active and available;
 if cid is null or lat is null or lng is null or accuracy is null or not(lat between -90 and 90 and lng between -180 and 180 and accuracy between 0 and 100) then raise exception 'Localização ou entregador indisponível';end if;
 insert into public.courier_positions values(cid,lat,lng,accuracy,now()) on conflict(courier_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,observed_at=now();
end$$;
-- Preserve legacy routes: a prior pickup means the route already departed.
update public.delivery_batches b set departed_at=now() where exists(select 1 from public.deliveries d where d.batch_id=b.id and d.status in ('retirada','entregue'));
update public.delivery_batches b set completed_at=now() where not exists(select 1 from public.deliveries d where d.batch_id=b.id and d.status not in ('entregue','cancelada'));
-- All assignment paths serialize per store, then lock the courier and delivery.
create function public.dg_assign_route(d uuid,c uuid,confirmed boolean,automatic boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare rec public.deliveries%rowtype; cr public.couriers%rowtype; b uuid; cap integer; s uuid; mode text;
begin
 select store_id into s from public.deliveries where id=d;
 if s is null then raise exception 'Entrega inexistente';end if;
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
end$$;
revoke all on function public.dg_assign_route(uuid,uuid,boolean,boolean) from public,anon,authenticated;
create function public.assign_order_courier(p_delivery uuid,p_courier uuid,p_confirm_deviation boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.deliveries where id=p_delivery and public.is_store_manager(store_id)) then raise exception 'Sem permissão';end if;
 return public.dg_assign_route(p_delivery,p_courier,p_confirm_deviation,false);
end$$;
-- Old entrypoints cannot bypass the route lock, capacity or confirmation.
create or replace function public.assign_delivery(d uuid,c uuid) returns void language plpgsql security definer set search_path='' as $$begin perform public.assign_order_courier(d,c,false);end$$;
create or replace function public.append_delivery_to_batch(s uuid,delivery_id uuid,p_batch_id uuid) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'Use Entrega e entregador no pedido e confirme o possível desvio';end$$;
create or replace function public.assign_delivery_batch(s uuid,courier uuid,delivery_ids uuid[]) returns uuid language plpgsql security definer set search_path='' as $$begin raise exception 'Use Entrega e entregador no pedido para confirmar cada inclusão';end$$;
-- Automatic scheduling is a server worker, never the browser or legacy insert trigger.
create or replace function public.dispatch_delivery_on_insert() returns trigger language plpgsql security definer set search_path='' as $$begin return new;end$$;
create or replace function public.auto_assign_delivery(s uuid) returns uuid language plpgsql security definer set search_path='' as $$begin raise exception 'Aguardando alocação pelo serviço de rotas com GPS e trajeto verificados';end$$;
create function public.collect_delivery(p_delivery uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update public.deliveries set collected_at=coalesce(collected_at,now()) where id=p_delivery and status='aceita' and public.is_courier(courier_id);
 if not found then raise exception 'Aceite a entrega antes de confirmar a coleta';end if;
end$$;
create function public.depart_route(p_route uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.delivery_batches%rowtype;begin
 select * into r from public.delivery_batches where id=p_route;
 if not found or not public.is_courier(r.courier_id) then raise exception 'Sem permissão';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.store_id::text,13));
 perform 1 from public.couriers where id=r.courier_id for update;
 select * into r from public.delivery_batches where id=p_route for update;
 if r.departed_at is not null then return;end if;
 if r.completed_at is not null or not exists(select 1 from public.deliveries where batch_id=r.id and status='aceita') or exists(select 1 from public.deliveries where batch_id=r.id and status<>'cancelada' and (status<>'aceita' or collected_at is null)) then raise exception 'Aceite e colete todos os pedidos da rota antes de sair';end if;
 update public.delivery_batches set departed_at=now() where id=r.id;
 update public.deliveries set status='retirada',updated_at=now() where batch_id=r.id and status='aceita';
 insert into public.operation_audit(store_id,actor,action,details) values(r.store_id,auth.uid(),'route_departed',jsonb_build_object('route',r.id));
end$$;
create or replace function public.set_delivery_status(d uuid,next_status text) returns void language plpgsql security definer set search_path='' as $$
declare rec public.deliveries%rowtype; s uuid;begin
 select store_id into s from public.deliveries where id=d;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into rec from public.deliveries where id=d for update;
 if not found or rec.logistics_provider<>'loja' then raise exception 'Entrega indisponível';end if;
 if not ((public.is_store_manager(rec.store_id) and rec.status in ('pendente','atribuida') and next_status='cancelada') or (public.is_courier(rec.courier_id) and ((rec.status='atribuida' and next_status='aceita') or (rec.status='aceita' and next_status='retirada' and rec.batch_id is null) or (rec.status='retirada' and next_status='entregue')))) then raise exception 'Transição não permitida; utilize a saída da rota após coletar';end if;
 if next_status='entregue' and rec.requires_delivery_code and rec.delivery_code_verified_at is null then raise exception 'Código ainda não confirmado pela plataforma';end if;
 update public.deliveries set status=next_status,updated_at=now() where id=d;
 if rec.batch_id is not null and not exists(select 1 from public.deliveries where batch_id=rec.batch_id and status not in ('entregue','cancelada')) then update public.delivery_batches set completed_at=now() where id=rec.batch_id;end if;
end$$;
-- Coordinates are explicit, never inferred from address text or zero-filled.
create function public.save_dispatch_location(p_store uuid,p_lat double precision,p_lng double precision) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissão';end if;
 if p_lat is null or p_lng is null then raise exception 'Informe coordenadas';end if;
 update public.stores set latitude=p_lat,longitude=p_lng where id=p_store;
end$$;
create function public.save_delivery_location(p_delivery uuid,p_lat double precision,p_lng double precision,p_deadline timestamptz) returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.deliveries where id=p_delivery and public.is_store_manager(store_id) and status='pendente' and logistics_provider='loja') or p_lat is null or p_lng is null or p_deadline is null or p_deadline<=now() then raise exception 'Entrega, coordenadas ou prazo inválidos';end if;
 update public.deliveries set latitude=p_lat,longitude=p_lng,deliver_by=p_deadline,updated_at=now() where id=p_delivery;
end$$;
-- Worker snapshots are capabilities retained server-side, expire quickly and are compared
-- under the same assignment lock. A public client cannot manufacture a route approval.
create table public.dispatch_checks(id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),delivery_id uuid not null references public.deliveries(id),courier_id uuid not null references public.couriers(id),snapshot jsonb not null,created_at timestamptz not null default now(),used_at timestamptz);
alter table public.dispatch_checks enable row level security;
revoke all on public.dispatch_checks from anon,authenticated;
create function public.dg_dispatch_snapshot(s uuid,d uuid,c uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('store',(select to_jsonb(x) from (select id,latitude,longitude,max_orders_per_trip,dispatch_mode from public.stores where id=s)x),'delivery',(select to_jsonb(x) from (select id,latitude,longitude,deliver_by,status,courier_id,batch_id,logistics_provider,updated_at from public.deliveries where id=d)x),'courier',(select to_jsonb(x) from (select id,active,available,fleet_type,store_id from public.couriers where id=c)x),'gps',(select to_jsonb(x) from public.courier_positions x where courier_id=c),'stops',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select a.id,a.latitude,a.longitude,a.deliver_by,a.status,a.batch_id,a.updated_at,b.departed_at from public.deliveries a left join public.delivery_batches b on a.batch_id=b.id where a.courier_id=c and a.status not in ('entregue','cancelada'))x),'[]'::jsonb))
$$;
revoke all on function public.dg_dispatch_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
create function public.dispatch_candidates() returns jsonb language plpgsql security definer set search_path='' as $$
declare x record; token uuid; snap jsonb; result jsonb:='[]';begin
 delete from public.dispatch_checks where created_at<now()-interval '10 minutes';
 for x in select s.id s,d.id d,c.id c from public.stores s join public.deliveries d on d.store_id=s.id join public.couriers c on c.store_id=s.id join public.courier_positions p on p.courier_id=c.id
 where s.dispatch_mode in ('automatico','misto') and s.delivery_mode in ('propria','ambas') and s.latitude is not null and s.longitude is not null and d.status='pendente' and d.courier_id is null and d.logistics_provider='loja' and d.latitude is not null and d.longitude is not null and d.deliver_by>now() and c.active and c.available and c.fleet_type='propria' and p.observed_at>now()-interval '90 seconds'
 and not exists(select 1 from public.deliveries a left join public.delivery_batches b on b.id=a.batch_id where a.courier_id=c.id and a.status not in ('entregue','cancelada') and (b.id is null or b.departed_at is not null)) order by d.created_at,d.id,c.id limit 100 loop
 snap:=public.dg_dispatch_snapshot(x.s,x.d,x.c);
 insert into public.dispatch_checks(store_id,delivery_id,courier_id,snapshot) values(x.s,x.d,x.c,snap) returning id into token;
 result:=result||jsonb_build_array(jsonb_build_object('token',token,'data',snap));
 end loop;return result;
end$$;
create function public.commit_auto_dispatch(p_check uuid,p_evidence jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare k public.dispatch_checks%rowtype; current_snap jsonb; r uuid;begin
 select * into k from public.dispatch_checks where id=p_check;
 if not found then raise exception 'Validação inexistente';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(k.store_id::text,13));
 select * into k from public.dispatch_checks where id=p_check for update;
 if k.used_at is not null or k.created_at<now()-interval '30 seconds' then raise exception 'Validação expirada';end if;
 current_snap:=public.dg_dispatch_snapshot(k.store_id,k.delivery_id,k.courier_id);
 if current_snap<>k.snapshot then raise exception 'Rota alterada; recalcule';end if;
 if current_snap#>>'{store,dispatch_mode}' not in ('automatico','misto') or p_evidence->>'method' is distinct from 'directed-road-matrix' or p_evidence->>'compatible' is distinct from 'true' or coalesce(length(p_evidence->>'provider'),0)<1 then raise exception 'Trajeto não validado';end if;
 r:=public.dg_assign_route(k.delivery_id,k.courier_id,true,true);
 update public.dispatch_checks set used_at=now() where id=k.id;
 insert into public.operation_audit(store_id,action,details) values(k.store_id,'route_road_validation',jsonb_build_object('check',k.id,'evidence',p_evidence));return r;
end$$;
revoke all on function public.dispatch_candidates(),public.commit_auto_dispatch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dispatch_candidates(),public.commit_auto_dispatch(uuid,jsonb) to service_role;
revoke all on function public.courier_heartbeat(double precision,double precision,double precision),public.assign_order_courier(uuid,uuid,boolean),public.collect_delivery(uuid),public.depart_route(uuid),public.save_dispatch_location(uuid,double precision,double precision),public.save_delivery_location(uuid,double precision,double precision,timestamptz) from public,anon;
grant execute on function public.courier_heartbeat(double precision,double precision,double precision),public.assign_order_courier(uuid,uuid,boolean),public.collect_delivery(uuid),public.depart_route(uuid),public.save_dispatch_location(uuid,double precision,double precision),public.save_delivery_location(uuid,double precision,double precision,timestamptz) to authenticated;
commit;
