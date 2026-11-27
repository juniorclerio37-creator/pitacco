-- CI ONLY; no raw delivery/courier table access for the HTTP role.
-- Own fleet only: reuse original row scope, not the unavailable shared-fleet helper.
create function core_auth.own_logistics_fixture(s uuid,r text,lim integer,off integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Escopo não autorizado' using errcode='42501';end if;
 if lim is null or lim not between 1 and 100 or off is null or off not between 0 and 10000 then raise exception 'Paginação inválida' using errcode='22023';end if;
 case r
 when 'deliveries' then
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into result from (
  select d.id,d.store_id,d.order_id,d.customer_name,d.address,d.status,d.source,d.logistics_provider,d.courier_id,d.batch_id,d.manual_dispatch_hold,d.collected_at,d.arrived_at,d.capacity_released_at,d.latitude,d.longitude,d.deliver_by
  from public.deliveries d
  where d.store_id=s and d.source='proprio' and d.logistics_provider='loja'
   and exists(select 1 from public.pitacco_daily_operational_orders(s) o where o.id=d.order_id and o.store_id=s and o.source='proprio')
  order by d.id limit lim offset off
 ) q;
 when 'ifood-deliveries' then
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) into result from (
  select d.id,d.store_id,d.order_id,d.status,d.source,d.logistics_provider,d.courier_id,d.batch_id,d.manual_dispatch_hold,d.collected_at,d.arrived_at,d.capacity_released_at,d.latitude,d.longitude,d.deliver_by,d.external_delivery_status,d.arrival_provider_state
  from public.deliveries d
  where d.store_id=s and d.source='ifood' and d.logistics_provider='loja'
   and exists(select 1 from public.pitacco_daily_operational_orders(s) o where o.id=d.order_id and o.store_id=s and o.source='ifood')
  order by d.id limit lim offset off
 ) q;
 when 'couriers' then
 select coalesce(jsonb_agg(to_jsonb(q) order by q.name,q.id),'[]'::jsonb) into result from (
  select c.id,c.store_id,c.name,c.fleet_type,c.active,c.available from public.couriers c
  where c.store_id=s and c.active and c.fleet_type='propria' order by c.name,c.id limit lim offset off
 ) q;
 when 'positions' then
 select coalesce(jsonb_agg(to_jsonb(q) order by q.courier_id),'[]'::jsonb) into result from (
  select p.courier_id,p.latitude,p.longitude,p.observed_at,p.accuracy_m from public.courier_positions p
  join public.couriers c on c.id=p.courier_id and c.store_id=s and c.active and c.fleet_type='propria'
  order by p.courier_id limit lim offset off
 ) q;
 else raise exception 'Recurso inválido' using errcode='22023';
 end case;
 return result;
end $$;
revoke all on function core_auth.own_logistics_fixture(uuid,text,integer,integer) from public,anon,authenticated;
create role pitacco_core_own_logistics login password 'ci-own-logistics-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_own_logistics;
grant execute on function core_auth.can_act(uuid),core_auth.own_logistics_fixture(uuid,text,integer,integer) to pitacco_core_own_logistics;

-- CI-only confirmed canonical marker, following the original store-point rules.
create function core_auth.store_point_fixture(s uuid,lat numeric,lng numeric) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare result jsonb; counter integer;
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 if lat is not null or lng is not null then
  if lat is null or lng is null or lat not between -34 and 6 or lng not between -75 and -32 then raise exception 'Ponto inválido' using errcode='22023';end if;
  if not exists(select 1 from public.stores x where x.id=s and nullif(trim(x.address),'') is not null and nullif(trim(x.city),'') is not null and nullif(trim(x.state),'') is not null) then raise exception 'Endereço incompleto' using errcode='22023';end if;
  -- Same original fixed-hour bucket and scope, with no service_role impersonation.
  -- No arbitrary scope, window or max can be supplied by this HTTP role.
  insert into pitacco_private.delivery_quote_rate_limits(scope,window_start,attempts)
  values('store-map-point-hour-'||s::text,to_timestamp(floor(extract(epoch from now())/3600)*3600),1)
  on conflict(scope,window_start) do update set attempts=pitacco_private.delivery_quote_rate_limits.attempts+1
    where pitacco_private.delivery_quote_rate_limits.attempts<30
  returning attempts into counter;
  if counter is null then raise exception 'Limite de ponto' using errcode='P0001';end if;
  update public.stores set latitude=round(lat,6),longitude=round(lng,6) where id=s;
 end if;
 select jsonb_build_object('id',x.id,'name',x.name,'latitude',x.latitude,'longitude',x.longitude,'saved',lat is not null) into result from public.stores x where x.id=s;
 return result;
end $fn$;
revoke all on function core_auth.store_point_fixture(uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function core_auth.store_point_fixture(uuid,numeric,numeric) to pitacco_core_own_logistics;

-- Same data model for web and Windows, read-only snapshot.
create function core_auth.fleet_map_fixture(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare shop jsonb; fleet jsonb; stops jsonb; positions jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 select jsonb_build_object('id',x.id,'name',x.name,'latitude',x.latitude,'longitude',x.longitude,'address',x.address,'address_number',x.address_number,'neighborhood',x.neighborhood,'city',x.city,'state',x.state,'postal_code',x.postal_code) into shop from public.stores x where x.id=s;
 select coalesce(jsonb_agg(q order by q.id),'[]'::jsonb) into fleet from (select c.id,c.name,c.store_id,c.active,c.available,c.fleet_type from public.couriers c where c.store_id=s and c.active and c.fleet_type='propria') q;
 select coalesce(jsonb_agg(q order by q.created_at desc,q.id),'[]'::jsonb) into stops from (
  select d.id,d.order_id,d.store_id,d.courier_id,d.status,d.logistics_provider,d.source,d.latitude,d.longitude,d.batch_id,d.address,d.customer_name,d.collected_at,d.arrived_at,d.created_at,d.deliver_by
  from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id and o.source=d.source
  where d.store_id=s and d.logistics_provider='loja' and d.status in ('pendente','atribuida','aceita','retirada') and d.source in ('proprio','ifood') and o.status='accepted'
  and (d.courier_id is null or exists(select 1 from public.couriers c where c.id=d.courier_id and c.store_id=s and c.active and c.fleet_type='propria'))
  and (d.source='proprio' or (o.receipt->>'ifood_status' in ('CONFIRMED','READY_TO_PICKUP','DISPATCHED') and coalesce(o.receipt->>'ifood_manual_cancel','')<>'requested'))
  order by d.created_at desc,d.id limit 200
 ) q;
 select coalesce(jsonb_agg(q order by q.courier_id),'[]'::jsonb) into positions from (
  select p.courier_id,p.latitude,p.longitude,p.accuracy_m,p.observed_at
  from public.courier_positions p join public.couriers c on c.id=p.courier_id and c.store_id=s and c.active and c.available and c.fleet_type='propria'
  where p.observed_at between now()-interval '120 seconds' and now()+interval '30 seconds' and p.accuracy_m between 0 and 2000
 ) q;
 return jsonb_build_object('store',shop,'couriers',fleet,'deliveries',stops,'positions',positions,'motion','[]'::jsonb);
end $fn$;
revoke all on function core_auth.fleet_map_fixture(uuid) from public,anon,authenticated;
grant execute on function core_auth.fleet_map_fixture(uuid) to pitacco_core_own_logistics;

-- CI only: deterministic, server-side geocoding responses. No external calls.
-- This table is not accessible to the HTTP role and never ships to production.
create table core_auth.store_geocode_fixture (
 store_id uuid primary key references public.stores(id),
 address text not null, address_number text, neighborhood text, city text not null,
 state text not null, postal_code text,
 latitude numeric not null check(latitude between -34 and 6),
 longitude numeric not null check(longitude between -75 and -32),
 precise boolean not null
);
revoke all on core_auth.store_geocode_fixture from public,anon,authenticated,pitacco_core_own_logistics;
-- Two-phase rehearsal. Network work must never hold the canonical store lock.
create table core_auth.store_origin_reservations(
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 session_id uuid not null references core_auth.sessions(id), address jsonb not null,
 expires_at timestamptz not null, consumed boolean not null default false
);
revoke all on core_auth.store_origin_reservations from public,anon,authenticated,pitacco_core_own_logistics;

create function core_auth.store_origin_reserve(s uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare shop public.stores%rowtype; sid uuid:=nullif(current_setting('pitacco.core_session_id',true),'')::uuid;
 addr jsonb; counter integer; ticket uuid; bucket timestamptz; sample jsonb;
begin
 if not core_auth.can_act(s) or not exists(select 1 from core_auth.sessions where id=sid and user_id=auth.uid() and revoked_at is null and expires_at>now()) then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into shop from public.stores where id=s for update;
 if not found or nullif(trim(shop.address),'') is null or nullif(trim(shop.city),'') is null or nullif(trim(shop.state),'') is null then raise exception 'Endereço incompleto' using errcode='22023';end if;
 if shop.latitude between -34 and 6 and shop.longitude between -75 and -32 then
  return jsonb_build_object('latitude',shop.latitude,'longitude',shop.longitude,'approximate',false,'cached',true,'saved',true,'requires_confirmation',false);
 end if;
 bucket:=to_timestamp(floor(extract(epoch from now())/3600)*3600);
 -- Fixed conservative simulation limits, not a provider plan or production config.
 -- All reservations take the global locks in the same order. A rejected reservation
 -- rolls back every increment; a provider failure after commit consumes the budget.
 insert into pitacco_private.delivery_quote_rate_limits(scope,window_start,attempts)
 values('core-origin-global-day',to_timestamp(floor(extract(epoch from now())/86400)*86400),1)
 on conflict(scope,window_start) do update set attempts=pitacco_private.delivery_quote_rate_limits.attempts+1
 where pitacco_private.delivery_quote_rate_limits.attempts<500 returning attempts into counter;
 if counter is null then raise exception 'Limite diário' using errcode='P0001';end if;
 insert into pitacco_private.delivery_quote_rate_limits(scope,window_start,attempts)
 values('core-origin-global-hour',bucket,1)
 on conflict(scope,window_start) do update set attempts=pitacco_private.delivery_quote_rate_limits.attempts+1
 where pitacco_private.delivery_quote_rate_limits.attempts<100 returning attempts into counter;
 if counter is null then raise exception 'Limite global' using errcode='P0001';end if;
 insert into pitacco_private.delivery_quote_rate_limits(scope,window_start,attempts)
 values('origin-hour-'||s::text,bucket,1)
 on conflict(scope,window_start) do update set attempts=pitacco_private.delivery_quote_rate_limits.attempts+1
 where pitacco_private.delivery_quote_rate_limits.attempts<24 returning attempts into counter;
 if counter is null then raise exception 'Limite de origem' using errcode='P0001';end if;
 addr:=jsonb_build_object('address',shop.address,'address_number',shop.address_number,'neighborhood',shop.neighborhood,'city',shop.city,'state',shop.state,'postal_code',shop.postal_code);
 -- Bounded cleanup of expired reservations in the same store; quota remains.
 delete from core_auth.store_origin_reservations where id in (select id from core_auth.store_origin_reservations where store_id=s and expires_at<now()-interval '1 minute' order by expires_at limit 100);
 insert into core_auth.store_origin_reservations(store_id,session_id,address,expires_at) values(s,sid,addr,now()+interval '30 seconds') returning id into ticket;
 -- Capture a Geoapify-shaped synthetic result from the private fixture. The
 -- server-side matcher, not the HTTP client, decides whether it is acceptable.
 select jsonb_build_object('country_code','br','lat',f.latitude,'lon',f.longitude,
 'street',f.address,'city',f.city,'suburb',f.neighborhood,'postcode',f.postal_code,
 'housenumber',case when f.precise then f.address_number else null end,
 'result_type',case when f.precise then 'building' else 'street' end,
 'rank',jsonb_build_object('confidence',case when f.precise then 0.92 else 0.80 end))
 into sample from core_auth.store_geocode_fixture f where f.store_id=s
 and (f.address,f.address_number,f.neighborhood,f.city,f.state,f.postal_code)
 is not distinct from (shop.address,shop.address_number,shop.neighborhood,shop.city,shop.state,shop.postal_code);
 return jsonb_build_object('reservation',ticket,'address',addr,'provider_fixture',
 jsonb_build_object('results',case when sample is null then '[]'::jsonb else jsonb_build_array(sample) end));
end $fn$;

-- CI only: use a private synthetic response instead of external Geoapify.
-- Ticket is never exposed to the browser. Recheck session and scope after the
-- simulated provider step; compare all six address fields, preserve manual point.
create function core_auth.store_origin_finish(s uuid,ticket uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare shop public.stores%rowtype; res core_auth.store_origin_reservations%rowtype;
 result core_auth.store_geocode_fixture%rowtype; sid uuid:=nullif(current_setting('pitacco.core_session_id',true),'')::uuid;
 addr jsonb;
begin
 if not core_auth.can_act(s) or not exists(select 1 from core_auth.sessions where id=sid and user_id=auth.uid() and revoked_at is null and expires_at>now()) then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into shop from public.stores where id=s for update;
 select * into res from core_auth.store_origin_reservations where id=ticket and store_id=s and session_id=sid and expires_at>now() and not consumed for update;
 if not found then raise exception 'Reserva indisponível' using errcode='42501';end if;
 update core_auth.store_origin_reservations set consumed=true where id=ticket;
 addr:=jsonb_build_object('address',shop.address,'address_number',shop.address_number,'neighborhood',shop.neighborhood,'city',shop.city,'state',shop.state,'postal_code',shop.postal_code);
 if addr is distinct from res.address then return jsonb_build_object('unavailable',true);end if;
 if shop.latitude between -34 and 6 and shop.longitude between -75 and -32 then
  return jsonb_build_object('latitude',shop.latitude,'longitude',shop.longitude,'approximate',false,'cached',true,'saved',true,'requires_confirmation',false);
 end if;
 select * into result from core_auth.store_geocode_fixture f where f.store_id=s
 and (f.address,f.address_number,f.neighborhood,f.city,f.state,f.postal_code)
 is not distinct from (shop.address,shop.address_number,shop.neighborhood,shop.city,shop.state,shop.postal_code);
 if not found or p is null or p='null'::jsonb then return jsonb_build_object('unavailable',true);end if;
 -- In CI even the trusted service cannot persist coordinates different from
 -- the private fixture. A real provider adapter will need its own audited role.
 if jsonb_typeof(p) is distinct from 'object'
 or jsonb_typeof(p->'latitude') is distinct from 'number'
 or jsonb_typeof(p->'longitude') is distinct from 'number'
 or jsonb_typeof(p->'approximate') is distinct from 'boolean'
 or p->>'provider' is distinct from 'geoapify'
 or (p->>'latitude')::numeric is distinct from round(result.latitude,6)
 or (p->>'longitude')::numeric is distinct from round(result.longitude,6)
 or (p->>'approximate')::boolean is distinct from not result.precise
 or p->'requires_confirmation' is distinct from p->'approximate' then
  return jsonb_build_object('unavailable',true);
 end if;
 if result.precise then update public.stores set latitude=round(result.latitude,6),longitude=round(result.longitude,6) where id=s;end if;
 return jsonb_build_object('latitude',round(result.latitude,6),'longitude',round(result.longitude,6),'approximate',not result.precise,'cached',false,'saved',result.precise,'requires_confirmation',not result.precise,'environment','simulation');
end $fn$;
revoke all on function core_auth.store_origin_reserve(uuid),core_auth.store_origin_finish(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function core_auth.store_origin_reserve(uuid),core_auth.store_origin_finish(uuid,uuid,jsonb) to pitacco_core_own_logistics;
