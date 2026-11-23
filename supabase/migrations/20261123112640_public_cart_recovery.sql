-- Read-only recovery of an ambiguous checkout. The random request UUID is a
-- capability kept by its originating browser, just like the tracking UUID.
-- No customer identity, credit, payment authorization or item data is exposed.
create or replace function public.pitacco_public_checkout_recovery(p_slug text,p_request uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('confirmed',true,'order_id',o.id,
  'tracking_token',c.tracking_token,'total',o.gross)
 from public.public_menu_settings m
 join public.public_checkouts c on c.store_id=m.store_id and c.request_id=p_request
 join public.orders o on o.id=c.order_id and o.store_id=m.store_id
 where m.slug=p_slug and p_request is not null limit 1),jsonb_build_object('confirmed',false));
$$;
revoke all on function public.pitacco_public_checkout_recovery(text,uuid) from public;
grant execute on function public.pitacco_public_checkout_recovery(text,uuid) to anon,authenticated;
