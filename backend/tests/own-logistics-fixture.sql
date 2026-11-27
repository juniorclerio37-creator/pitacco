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
declare result jsonb;
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 if lat is not null or lng is not null then
  if lat is null or lng is null or lat not between -34 and 6 or lng not between -75 and -32 then raise exception 'Ponto inválido' using errcode='22023';end if;
  if not exists(select 1 from public.stores x where x.id=s and nullif(trim(x.address),'') is not null and nullif(trim(x.city),'') is not null and nullif(trim(x.state),'') is not null) then raise exception 'Endereço incompleto' using errcode='22023';end if;
  if not public.pitacco_service_delivery_quote_limit('store-map-point-hour-'||s::text,30,60) then raise exception 'Limite de ponto' using errcode='P0001';end if;
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
