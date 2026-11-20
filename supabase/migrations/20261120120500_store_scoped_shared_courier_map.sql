-- Multi-store couriers must be visible ONLY to a manager/owner of the
-- selected shop. A direct couriers.store_id filter misses authorized shared
-- drivers.  Return GPS through a scoped RPC rather than broadening RLS.
create or replace function public.pitacco_store_couriers(p_store uuid)
returns setof public.couriers
language plpgsql stable security definer
set search_path to ''
as $$
begin
 if p_store is null or not public.pitacco_can_manage_courier_store((select auth.uid()),p_store) then
  raise exception 'Sem permissão para consultar entregadores desta loja' using errcode='42501';
 end if;
 return query select c.* from public.couriers c
 where c.active=true
 and (c.store_id=p_store or public.pitacco_courier_test_access(c.id,p_store))
 order by c.name,c.id;
end;
$$;

create or replace function public.pitacco_store_courier_positions(p_store uuid)
returns table(courier_id uuid, latitude double precision, longitude double precision,
              observed_at timestamptz, accuracy_m double precision)
language plpgsql stable security definer
set search_path to ''
as $$
begin
 if p_store is null or not public.pitacco_can_manage_courier_store((select auth.uid()),p_store) then
  raise exception 'Sem permissão para consultar GPS dos entregadores desta loja' using errcode='42501';
 end if;
 return query select p.courier_id,p.latitude,p.longitude,p.observed_at,p.accuracy_m
 from public.courier_positions p
 join public.couriers c on c.id=p.courier_id
 where c.active=true and (c.store_id=p_store or public.pitacco_courier_test_access(c.id,p_store));
end;
$$;
revoke all on function public.pitacco_store_couriers(uuid) from public,anon;
grant execute on function public.pitacco_store_couriers(uuid) to authenticated, service_role;
revoke all on function public.pitacco_store_courier_positions(uuid) from public,anon;
grant execute on function public.pitacco_store_courier_positions(uuid) to authenticated, service_role;
