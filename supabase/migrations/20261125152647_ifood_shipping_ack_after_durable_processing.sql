create or replace function public.pitacco_ifood_shipping_test_order_event_done(p_event uuid,p_merchant uuid,p_order uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from pitacco_private.ifood_events e join pitacco_private.ifood_merchants m using(merchant_id)
 where e.id=p_event and e.merchant_id=p_merchant and e.order_id=p_order and e.done_at is not null
 and m.test_only and m.enabled and m.credential is null)
$$;
revoke all on function public.pitacco_ifood_shipping_test_order_event_done(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_test_order_event_done(uuid,uuid,uuid) to service_role;;
