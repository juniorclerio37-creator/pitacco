-- Ensure the courier's map gets the confirmed shop origin for every
-- active, OWN assignment, not only batched orders already out for delivery.
-- This function never exposes unrelated stores or courier positions.
create or replace function public.pitacco_driver_route_origins()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $fn$
declare v_result jsonb;
begin
 if (select auth.uid()) is null
  or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select coalesce(
   pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'store_id',s.id,
     'latitude',s.latitude,
     'longitude',s.longitude
   ) order by s.id),'[]'::jsonb
 ) into v_result
 from public.stores s
 where exists(
  select 1 from public.deliveries d
  join public.couriers c on c.id=d.courier_id
    and c.active
    and (c.store_id=d.store_id or
         public.pitacco_courier_test_access(c.id,d.store_id))
  where d.store_id=s.id and c.user_id=(select auth.uid())
    and d.status in ('pendente','atribuida','aceita','retirada')
    and d.logistics_provider='loja'
 );
 return v_result;
end $fn$;

revoke all on function public.pitacco_driver_route_origins()
 from public,anon;
grant execute on function public.pitacco_driver_route_origins()
 to authenticated;
