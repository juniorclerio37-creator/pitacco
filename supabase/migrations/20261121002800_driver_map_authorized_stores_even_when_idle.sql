-- The live courier map always shows the confirmed locations of stores
-- explicitly authorized for this logged-in courier, even before orders.
-- No other stores are exposed; assigned orders remain separately RLS-scoped.
create or replace function public.pitacco_driver_route_origins()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $fn$
declare v_result jsonb;
begin
 if (select auth.uid()) is null or
    not public.pitacco_courier_session_ready() then
  raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select coalesce(pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object(
    'store_id',s.id,'latitude',s.latitude,'longitude',s.longitude
   ) order by s.id
  ),'[]'::jsonb) into v_result
 from public.stores s
 where exists(
  select 1 from public.couriers c
  where c.user_id=(select auth.uid()) and c.active
   and (c.store_id=s.id or
        public.pitacco_courier_test_access(c.id,s.id))
 );
 return v_result;
end $fn$;
revoke all on function public.pitacco_driver_route_origins()
 from public,anon;
grant execute on function public.pitacco_driver_route_origins()
 to authenticated;
