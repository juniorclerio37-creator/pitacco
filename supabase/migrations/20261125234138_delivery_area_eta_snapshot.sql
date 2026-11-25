alter table public.pitacco_delivery_pricing add column if not exists distance_times jsonb not null default '[]'::jsonb;
alter table public.pitacco_delivery_route_quotes add column if not exists delivery_min_minutes integer, add column if not exists delivery_max_minutes integer, add column if not exists delivery_region text;
create or replace function pitacco_private.valid_area_time(v jsonb) returns boolean language sql immutable set search_path='' as $$
select case when jsonb_typeof(v)='object' and jsonb_typeof(v->'min_minutes')='number' and jsonb_typeof(v->'max_minutes')='number' then
(v->>'min_minutes')::numeric between 1 and 720 and (v->>'max_minutes')::numeric between (v->>'min_minutes')::numeric and 720 and trunc((v->>'min_minutes')::numeric)=(v->>'min_minutes')::numeric and trunc((v->>'max_minutes')::numeric)=(v->>'max_minutes')::numeric else false end
$$;
-- Atomic wrappers preserve existing geometry and fee validation, then persist ETA in the same transaction.
create or replace function public.pitacco_save_delivery_zone_times(p_store uuid,p_radius integer,p_distance jsonb,p_times jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; i int;begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_radius is null or p_radius not between 1 and 10 or jsonb_typeof(p_times) is distinct from 'array' or jsonb_array_length(p_times)<>10 then raise exception 'Prazos por faixa inválidos';end if;
 for i in 0..p_radius-1 loop
  if not coalesce(pitacco_private.valid_area_time(p_times->i),false) then raise exception 'Informe prazo mínimo e máximo válidos para a faixa % km',i+1;end if;
 end loop;
 result:=public.pitacco_save_delivery_zone(p_store,'circle',p_radius,p_distance,'[]'::jsonb,0);
 update public.pitacco_delivery_pricing set distance_times=p_times,updated_at=now() where store_id=p_store;
 return result;
end $$;
create or replace function public.pitacco_save_delivery_polygons_times(p_store uuid,p_polygons jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v jsonb; normalized jsonb;begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if jsonb_typeof(p_polygons) is distinct from 'array' then raise exception 'Regiões inválidas';end if;
 for v in select value from jsonb_array_elements(p_polygons) loop
  if not coalesce(pitacco_private.valid_area_time(v),false) then raise exception 'Informe prazo mínimo e máximo válidos em cada região';end if;
 end loop;
 result:=public.pitacco_save_delivery_polygons(p_store,p_polygons);
 select jsonb_agg(a.value||jsonb_build_object('min_minutes',b.value->'min_minutes','max_minutes',b.value->'max_minutes') order by a.n) into normalized from jsonb_array_elements(result->'polygons') with ordinality a(value,n) join jsonb_array_elements(p_polygons) with ordinality b(value,n) using(n);
 update public.pitacco_delivery_pricing set polygons=normalized,updated_at=now() where store_id=p_store;
 return result||jsonb_build_object('polygons',normalized);
end $$;
revoke all on function public.pitacco_save_delivery_zone_times(uuid,integer,jsonb,jsonb),public.pitacco_save_delivery_polygons_times(uuid,jsonb) from public,anon;
grant execute on function public.pitacco_save_delivery_zone_times(uuid,integer,jsonb,jsonb),public.pitacco_save_delivery_polygons_times(uuid,jsonb) to authenticated;
-- Freeze only trusted server quote data, not browser supplied deadlines.
create or replace function pitacco_private.snapshot_delivery_eta()
returns trigger language plpgsql security definer set search_path='' as $$
declare q public.pitacco_delivery_route_quotes%rowtype; base timestamptz;begin
 if new.source='proprio' then
  new.receipt:=coalesce(new.receipt,'{}'::jsonb)-'delivery_eta';
  if new.receipt->>'logistics'='loja' and new.request_id is not null then
   select * into q from public.pitacco_delivery_route_quotes x where x.store_id=new.store_id and x.request_id=new.request_id and x.destination_address=trim(new.receipt->>'address') and x.expires_at>now() and exists(select 1 from public.pitacco_delivery_pricing p where p.store_id=x.store_id and p.enabled and p.updated_at=x.pricing_updated_at) order by x.created_at desc limit 1;
   if found then
    if pitacco_private.group_geo_valid(q.destination_latitude,q.destination_longitude) then
     new.receipt:=new.receipt||jsonb_build_object('delivery_location',jsonb_build_object('latitude',q.destination_latitude,'longitude',q.destination_longitude));
    end if;
    if new.scheduled_for is not null then
     new.receipt:=new.receipt||jsonb_build_object('delivery_eta',jsonb_build_object('earliest_at',new.scheduled_for,'latest_at',new.scheduled_for,'region',q.delivery_region,'scheduled',true));
    elsif q.delivery_min_minutes between 1 and 720 and q.delivery_max_minutes between q.delivery_min_minutes and 720 then
     base:=coalesce(new.created_at,now());
     new.receipt:=new.receipt||jsonb_build_object('delivery_eta',jsonb_build_object('min_minutes',q.delivery_min_minutes,'max_minutes',q.delivery_max_minutes,'earliest_at',base+make_interval(mins=>q.delivery_min_minutes),'latest_at',base+make_interval(mins=>q.delivery_max_minutes),'region',q.delivery_region));
    end if;
   end if;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists pitacco_snapshot_delivery_eta on public.orders;
create trigger pitacco_snapshot_delivery_eta before insert on public.orders for each row execute function pitacco_private.snapshot_delivery_eta();
create or replace function pitacco_private.group_copy_coordinates() returns trigger language plpgsql security definer set search_path='' as $$
declare rec jsonb; loc jsonb; la double precision; lo double precision; due timestamptz;
begin
 if new.logistics_provider='loja' and new.order_id is not null then
  select receipt into rec from public.orders where id=new.order_id and store_id=new.store_id;
  loc:=rec->'delivery_location';
  if (new.latitude is null or new.longitude is null) and jsonb_typeof(loc->'latitude')='number' and jsonb_typeof(loc->'longitude')='number' then
   la:=(loc->>'latitude')::double precision;lo:=(loc->>'longitude')::double precision;
   if pitacco_private.group_geo_valid(la,lo) then new.latitude:=la;new.longitude:=lo;end if;
  end if;
  if new.deliver_by is null and rec#>>'{delivery_eta,latest_at}' is not null then
   begin due:=(rec#>>'{delivery_eta,latest_at}')::timestamptz;new.deliver_by:=due;exception when invalid_datetime_format or datetime_field_overflow then null;end;
  end if;
 end if;return new;
end $$;
revoke all on function pitacco_private.snapshot_delivery_eta(),pitacco_private.group_copy_coordinates() from public,anon,authenticated;

