-- Extend the existing public projection, preserving the commercial order gate.
-- Only the shop's published weekly opening periods are exposed, never manager or billing data.
create or replace function pitacco_private.public_store_opening_status(p_store uuid)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select pitacco_private.store_opening_status(p_store,now()) ||
 jsonb_build_object('weekly_periods',case
  when exists(select 1 from public.pitacco_store_hours h where h.store_id=p_store)
  then (select coalesce(jsonb_agg(jsonb_build_object('weekday',p.weekday,'opens_minute',p.opens_minute,'closes_minute',p.closes_minute) order by p.weekday,p.opens_minute,p.slot),'[]'::jsonb)
  from public.pitacco_opening_periods p where p.store_id=p_store)
  else null end) ||
 case when coalesce((pitacco_private.control_store_order_gate(p_store)->>'orders_blocked')::boolean,false)
 then jsonb_build_object('open',false,'reason','paused','paused',true,'accepts_scheduled',false,'scheduling_available',false,'next_open_at',null)
 else '{}'::jsonb end
$fn$;
revoke all on function pitacco_private.public_store_opening_status(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
