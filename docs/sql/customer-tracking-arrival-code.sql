CREATE OR REPLACE FUNCTION public.pitacco_track_public_order(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
 'order_id',o.id,'public_number',public.pitacco_order_public_label(o.receipt,o.source),'status',o.status,'preparation_status',o.preparation_status,
 'created_at',o.created_at,'accepted_at',o.accepted_at,'scheduled_for',o.scheduled_for,
 'fulfillment',case when c.payload->>'fulfillment'='pickup' or o.receipt->>'address'='retirada' or o.receipt->>'logistics'='retirada' then 'pickup' else 'delivery' end,
 'delivery_status',d.status,'arrived_at',d.arrived_at,'total',o.gross,
 'delivery_code',case when o.source='proprio' and d.status='retirada' then
   (select pin.code from public.pitacco_own_delivery_codes pin where pin.delivery_id=d.id and pin.store_id=o.store_id)
   else null end,'courier_position',case when o.status='accepted' then pitacco_private.public_delivery_position(o.store_id,o.id) end,
 'store',jsonb_build_object('name',s.name,'logo_url',b.logo_url,'primary_color',coalesce(b.primary_color,'#db482f')),
 'items',coalesce(o.receipt->'items','[]'::jsonb),
 'payment_method',o.receipt->>'payment'
)
from public.public_checkouts c
join public.orders o on o.id=c.order_id and o.store_id=c.store_id
join public.stores s on s.id=o.store_id
left join public.store_customer_branding b on b.store_id=o.store_id
left join lateral(select id,status,arrived_at from public.deliveries where order_id=o.id and store_id=o.store_id order by created_at desc limit 1)d on true
where c.tracking_token=p_token and c.expires_at>now() limit 1
$function$
;
