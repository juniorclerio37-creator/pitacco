create function pitacco_private.public_delivery_position(p_store uuid,p_order uuid)
returns jsonb language sql stable set search_path = '' as $function$
  select case
    when exists (
      select 1 from public.deliveries other
       where other.id<>delivery.id and other.status not in ('entregue','cancelada')
         and ((delivery.batch_id is not null and other.batch_id=delivery.batch_id)
              or (other.courier_id=delivery.courier_id and other.status='retirada'))
    ) then jsonb_build_object('state','multiple_stops')
    when gps.observed_at is null
      or gps.observed_at not between greatest(route.departed_at,delivery.collected_at,delivery.updated_at,now()-interval '90 seconds') and now()
      or not coalesce(gps.latitude between -90 and 90 and gps.longitude between -180 and 180,false)
      then jsonb_build_object('state','awaiting_gps')
    else jsonb_build_object(
      'state','available','latitude',round(gps.latitude::numeric,3),
      'longitude',round(gps.longitude::numeric,3),'observed_at',gps.observed_at
    )
  end
  from public.deliveries delivery
  join public.couriers courier on courier.id=delivery.courier_id and courier.active
  left join public.courier_positions gps on gps.courier_id=courier.id
  left join public.delivery_batches route on route.id=delivery.batch_id and route.store_id=delivery.store_id
  where delivery.store_id=p_store and delivery.order_id=p_order
    and delivery.logistics_provider='loja' and delivery.status='retirada'
    and (delivery.batch_id is null or route.departed_at is not null)
  order by delivery.created_at desc limit 1
$function$;
revoke all on function pitacco_private.public_delivery_position(uuid,uuid) from public, anon, authenticated;

-- Keep the private order token and its expiry as the only public entry point
-- to location data. The shared GPS table remains unchanged and private.
do $migration$
declare
  definition text := pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure);
  tracking_key constant text := $sql$'delivery_status',d.status,'total',o.gross,$sql$;
  location_key constant text := $sql$'courier_position',case when o.status='accepted' then pitacco_private.public_delivery_position(o.store_id,o.id) end,$sql$;
begin
  if strpos(definition,tracking_key)=0 then
    raise exception 'Acompanhamento público difere da versão de referência';
  end if;
  execute replace(definition,tracking_key,tracking_key||location_key);
end;
$migration$;
