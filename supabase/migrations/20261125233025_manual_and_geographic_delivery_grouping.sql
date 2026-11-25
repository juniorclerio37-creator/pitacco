
create or replace function pitacco_private.group_geo_km(a double precision,b double precision,c double precision,d double precision)
returns double precision language sql immutable strict set search_path='' as $$
select 6371*2*asin(sqrt(least(1::double precision,greatest(0::double precision,power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2)))))
$$;
create or replace function pitacco_private.group_geo_valid(a double precision,b double precision)
returns boolean language sql immutable set search_path='' as $$
select coalesce(a between -90 and 90 and b between -180 and 180 and (a<>0 or b<>0),false)
$$;
create or replace function pitacco_private.group_geo_compatible(slat double precision,slon double precision,alat double precision,alon double precision,blat double precision,blon double precision)
returns boolean language sql immutable set search_path='' as $$
select case when not (pitacco_private.group_geo_valid(slat,slon) and pitacco_private.group_geo_valid(alat,alon) and pitacco_private.group_geo_valid(blat,blon)) then false
when pitacco_private.group_geo_km(slat,slon,alat,alon)<0.05 or pitacco_private.group_geo_km(slat,slon,blat,blon)<0.05 then false
else cos(atan2(sin(radians(alon-slon))*cos(radians(alat)),cos(radians(slat))*sin(radians(alat))-sin(radians(slat))*cos(radians(alat))*cos(radians(alon-slon)))-
atan2(sin(radians(blon-slon))*cos(radians(blat)),cos(radians(slat))*sin(radians(blat))-sin(radians(slat))*cos(radians(blat))*cos(radians(blon-slon))))>=cos(radians(45::double precision)) end
$$;
-- Only actual saved checkout coordinates, never infer from the address or invent a deadline.
create or replace function pitacco_private.group_copy_coordinates()
returns trigger language plpgsql security definer set search_path='' as $$
declare loc jsonb; la double precision; lo double precision;
begin
 if new.logistics_provider='loja' and new.order_id is not null and (new.latitude is null or new.longitude is null) then
  select receipt->'delivery_location' into loc from public.orders where id=new.order_id and store_id=new.store_id;
  if jsonb_typeof(loc->'latitude')='number' and jsonb_typeof(loc->'longitude')='number' then
   la:=(loc->>'latitude')::double precision;lo:=(loc->>'longitude')::double precision;
   if pitacco_private.group_geo_valid(la,lo) then new.latitude:=la;new.longitude:=lo;end if;
  end if;
 end if;return new;
end $$;
drop trigger if exists pitacco_group_copy_coordinates on public.deliveries;
create trigger pitacco_group_copy_coordinates before insert on public.deliveries for each row execute function pitacco_private.group_copy_coordinates();
-- Reuse the existing transaction/route lock and order-stage gate, also reject a pending partner booking.
do $patch$
declare f text;
begin
 select pg_get_functiondef('public.dg_assign_route(uuid,uuid,boolean,boolean)'::regprocedure) into f;
 if position('SHIPPING_REQUESTING' in f)=0 then
  if position('if rec.logistics_provider' in f)=0 then raise exception 'Assignment guard not found';end if;
  f:=replace(f,'if rec.logistics_provider', 'if coalesce(rec.external_delivery_status,'''') in (''SHIPPING_REQUESTING'',''SHIPPING_SUBMITTED'',''SHIPPING_UNCERTAIN'') then raise exception ''Entrega parceira em solicitação'';end if; if rec.logistics_provider');
  execute f;
 end if;
end $patch$;
-- Batch is atomic; any failure undoes the entire batch. Same lock as departure.
create or replace function public.assign_delivery_batch(s uuid,courier uuid,delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare x uuid; r uuid; cap integer; cr public.couriers%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(s) then raise exception 'Sem permissão' using errcode='42501'; end if;
 if delivery_ids is null or cardinality(delivery_ids)<2 or cardinality(delivery_ids)>15 or cardinality(delivery_ids)<>(select count(distinct u) from unnest(delivery_ids) u) then raise exception 'Selecione de 2 a 15 pedidos distintos';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select max_orders_per_trip into cap from public.stores where id=s;
 select * into cr from public.couriers where id=courier for update;
 if not found or not cr.active or not cr.available or cr.fleet_type<>'propria' or (cr.store_id<>s and not public.pitacco_courier_test_access(courier,s)) or not exists(select 1 from public.courier_positions p where p.courier_id=courier and p.observed_at between now()-interval '90 seconds' and now()+interval '5 seconds') then raise exception 'Entregador indisponível ou sem GPS recente';end if;
 if cardinality(delivery_ids)+(select count(*) from public.deliveries d where d.courier_id=courier and d.status not in ('entregue','cancelada') and d.capacity_released_at is null and not(d.id=any(delivery_ids)))>cap then raise exception 'Limite de pedidos por viagem atingido';end if;
 foreach x in array delivery_ids loop
  if not exists(select 1 from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.id=x and d.store_id=s and d.logistics_provider='loja' and d.capacity_released_at is null and d.status='pendente' and d.courier_id is null and d.batch_id is null and o.status='accepted' and o.preparation_status='ready') then raise exception 'Um pedido não está mais pronto para agrupamento';end if;
  r:=public.dg_assign_route(x,courier,true,false);
 end loop;
 return r;
end $$;
revoke all on function public.assign_delivery_batch(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.assign_delivery_batch(uuid,uuid,uuid[]) to authenticated;
-- Internal approximate grouping: same heading, short extra distance, known deadlines.
create or replace function pitacco_private.group_auto_one(s uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare st public.stores%rowtype; q record; result uuid; 
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into st from public.stores where id=s;
 if not found or st.dispatch_mode not in ('automatico','misto') or st.delivery_mode not in ('propria','ambas') then return null;end if;
 for q in
  select d.id did,c.id cid, count(a.id) load,
    pitacco_private.group_geo_km(st.latitude,st.longitude,p.latitude,p.longitude) approach
  from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=s
  join public.couriers c on c.store_id=s and c.active and c.available and c.fleet_type='propria'
  join public.courier_positions p on p.courier_id=c.id and p.observed_at between now()-interval '90 seconds' and now()+interval '5 seconds'
  left join public.deliveries a on a.courier_id=c.id and a.status not in ('entregue','cancelada') and a.capacity_released_at is null
  left join public.delivery_batches b on b.id=a.batch_id
  where d.store_id=s and d.status='pendente' and d.courier_id is null and d.batch_id is null and d.logistics_provider='loja'
    and coalesce(d.external_delivery_status,'') not in ('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN')
    and o.status='accepted' and o.preparation_status='ready' and (d.deliver_by is null or d.deliver_by>now())
  group by d.id,c.id,p.latitude,p.longitude
  having count(a.id)<st.max_orders_per_trip and
   coalesce(bool_and(a.store_id=s and b.id is not null and b.departed_at is null and b.completed_at is null and a.status in ('atribuida','aceita')),true)
   and (count(a.id)=0 or (
    d.deliver_by is not null and
    coalesce(bool_and(a.deliver_by is not null and a.deliver_by>now() and pitacco_private.group_geo_compatible(st.latitude,st.longitude,a.latitude,a.longitude,d.latitude,d.longitude)
    and (pitacco_private.group_geo_km(a.latitude,a.longitude,d.latitude,d.longitude)+least(pitacco_private.group_geo_km(st.latitude,st.longitude,a.latitude,a.longitude),pitacco_private.group_geo_km(st.latitude,st.longitude,d.latitude,d.longitude))-greatest(pitacco_private.group_geo_km(st.latitude,st.longitude,a.latitude,a.longitude),pitacco_private.group_geo_km(st.latitude,st.longitude,d.latitude,d.longitude)))<=1),false)
    and least(d.deliver_by,min(a.deliver_by))> now()+make_interval(secs=> (coalesce(pitacco_private.group_geo_km(st.latitude,st.longitude,p.latitude,p.longitude),0)+pitacco_private.group_geo_km(st.latitude,st.longitude,d.latitude,d.longitude)+sum(pitacco_private.group_geo_km(st.latitude,st.longitude,a.latitude,a.longitude)))*240+(count(a.id)+1)*120)
   ))
  order by d.deliver_by asc nulls last,d.created_at,d.id,count(a.id) desc,approach nulls last,c.id limit 25
 loop
  begin
   result:=public.dg_assign_route(q.did,q.cid,true,true);
   insert into public.operation_audit(store_id,action,details) values(s,'route_geographic_auto_validation',jsonb_build_object('delivery',q.did,'courier',q.cid,'route',result,'method','geographic_estimate','existing_stops',q.load));
   return result;
  exception when others then
   -- Concurrent changes must leave this candidate unassigned.
   continue;
  end;
 end loop;return null;
end $$;
revoke all on function pitacco_private.group_auto_one(uuid) from public,anon,authenticated;
create or replace function public.auto_assign_delivery(s uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 return pitacco_private.group_auto_one(s);
end $$;
revoke all on function public.auto_assign_delivery(uuid) from public,anon;
grant execute on function public.auto_assign_delivery(uuid) to authenticated;
create or replace function pitacco_private.group_auto_tick() returns integer language plpgsql security definer set search_path='' as $$
declare s uuid; r uuid; n integer:=0;
begin
 for s in select id from public.stores where dispatch_mode in ('automatico','misto') and exists(select 1 from public.deliveries d join public.orders o on o.id=d.order_id where d.store_id=stores.id and d.logistics_provider='loja' and d.status='pendente' and d.courier_id is null and o.status='accepted' and o.preparation_status='ready') order by id limit 100 loop
  r:=pitacco_private.group_auto_one(s);if r is not null then n:=n+1;end if;
 end loop;return n;
end $$;
revoke all on function pitacco_private.group_auto_tick() from public,anon,authenticated;

