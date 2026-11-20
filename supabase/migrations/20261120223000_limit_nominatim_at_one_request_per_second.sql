-- Enforce one upstream OpenStreetMap Nominatim request per second globally.
-- A second, existing limiter caps sustained use to 12 calls/minute.
create or replace function public.pitacco_service_nominatim_second_slot()
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare acquired integer;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Somente serviço autorizado' using errcode='42501';
  end if;
  insert into pitacco_private.delivery_quote_rate_limits(scope,window_start,attempts)
  values('pitacco-osm-geocode-global-second',date_trunc('second',clock_timestamp()),1)
  on conflict (scope,window_start) do nothing
  returning attempts into acquired;
  return acquired is not null;
end
$function$;

revoke all on function public.pitacco_service_nominatim_second_slot()
  from public, anon, authenticated;
grant execute on function public.pitacco_service_nominatim_second_slot()
  to service_role;
