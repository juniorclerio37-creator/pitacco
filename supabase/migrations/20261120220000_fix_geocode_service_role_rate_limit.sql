-- Fix store auto-geocoding via delivery-quote/store-origin.
-- Supabase's new secret API keys do not always populate the legacy
-- request.jwt.claim.role GUC. PostgREST still sets the verified database
-- role. Use the role selected by the database API, not a legacy JWT GUC.
-- Keep the rate limiter service-only; do not expose it to storefront clients.
create or replace function public.pitacco_service_delivery_quote_limit(
  p_scope text, p_max integer, p_minutes integer
) returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare bucket timestamptz; counter integer;
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Somente serviço autorizado' using errcode='42501';
  end if;
  if p_max not between 1 and 1000 or p_minutes not in (1,60,1440)
    or length(p_scope) not between 10 and 180 then
    raise exception 'Parâmetros inválidos';
  end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / (p_minutes*60)) * (p_minutes*60));
  insert into pitacco_private.delivery_quote_rate_limits(scope, window_start, attempts)
  values(p_scope, bucket, 1)
  on conflict(scope, window_start) do update
    set attempts=pitacco_private.delivery_quote_rate_limits.attempts+1
    where pitacco_private.delivery_quote_rate_limits.attempts<p_max
  returning attempts into counter;
  return counter is not null;
end $function$;

revoke all on function public.pitacco_service_delivery_quote_limit(text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.pitacco_service_delivery_quote_limit(text,integer,integer)
  to service_role;
