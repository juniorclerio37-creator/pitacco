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
