-- A lost confirmation must remain recoverable after quote expiry or a store
-- configuration change. Only a committed checkout may use its saved point;
-- the checkout RPC still compares the entire canonical payload before replay.
create or replace function public.pitacco_delivery_quote_point(
 p_quote uuid,p_request uuid,p_address text
) returns jsonb language sql stable security definer set search_path='' as $$
 select case
  when c.order_id is not null then c.payload->'delivery_location'
  when q.expires_at>now() and exists(
   select 1 from public.pitacco_delivery_pricing p
   where p.store_id=q.store_id and p.enabled and p.updated_at=q.pricing_updated_at
  ) then jsonb_build_object('latitude',q.destination_latitude,'longitude',q.destination_longitude)
  else null end
 from public.pitacco_delivery_route_quotes q
 left join public.public_checkouts c on c.store_id=q.store_id and c.request_id=q.request_id
  and c.payload->>'address'=q.destination_address and c.payload->>'fulfillment'='delivery'
 where q.id=p_quote and q.request_id=p_request and q.destination_address=trim(p_address)
  and q.destination_latitude between -34 and 6
  and q.destination_longitude between -75 and -32
 limit 1;
$$;
revoke all on function public.pitacco_delivery_quote_point(uuid,uuid,text) from public;
grant execute on function public.pitacco_delivery_quote_point(uuid,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
