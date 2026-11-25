CREATE OR REPLACE FUNCTION public.pitacco_ifood_shipping_test_context(p_store uuid, p_actor uuid DEFAULT NULL::uuid, p_order uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m pitacco_private.ifood_merchants%rowtype; n integer; s public.stores%rowtype; o public.orders%rowtype; d public.deliveries%rowtype; ext uuid; eligible jsonb;
begin
 if p_actor is not null and not exists(select 1 from pitacco_private.platform_owner where user_id=p_actor) and not exists(select 1 from public.store_members where user_id=p_actor and store_id=p_store and role='gestor') then raise exception 'unauthorized';end if;
 select count(*) into n from pitacco_private.ifood_merchants where store_id=p_store and test_only and enabled and credential is null;
 if n<>1 then raise exception 'exactly one centralized test merchant required';end if;
 select * into m from pitacco_private.ifood_merchants where store_id=p_store and test_only and enabled and credential is null;
 select * into s from public.stores where id=p_store;
 if not found then raise exception 'store unavailable';end if;
 if p_order is not null then
  select * into o from public.orders where id=p_order and store_id=p_store and source='ifood' and receipt->>'ifood_test'='true' and status in ('pending','accepted');
  if not found then raise exception 'test order unavailable';end if;
  select external_id into ext from pitacco_private.ifood_order_links where order_id=o.id and merchant_id=m.merchant_id;
  if ext is null then raise exception 'test order not linked';end if;
  select * into d from public.deliveries where order_id=o.id and store_id=p_store;
  return jsonb_build_object('merchant_id',m.merchant_id,'order_id',o.id,'external_id',ext,'eligible',coalesce(o.receipt->>'logistics'='loja' and (d.id is null or (d.logistics_provider='loja' and d.status='pendente' and d.courier_id is null)),false));
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'number',t.number,'status',t.status) order by t.created_at desc),'[]'::jsonb) into eligible from (
  select ord.id,coalesce(ord.receipt->>'display_number',left(ord.id::text,8)) as number,ord.status,ord.created_at
  from public.orders ord join pitacco_private.ifood_order_links l on l.order_id=ord.id and l.merchant_id=m.merchant_id left join public.deliveries del on del.order_id=ord.id
  where ord.store_id=p_store and ord.source='ifood' and ord.receipt->>'ifood_test'='true' and ord.receipt->>'logistics'='loja' and ord.status in ('pending','accepted')
  and (del.id is null or(del.status='pendente' and del.courier_id is null and del.logistics_provider='loja')) order by ord.created_at desc limit 30
 ) t;
 return jsonb_build_object('merchant_id',m.merchant_id,'store_latitude',s.latitude,'store_longitude',s.longitude,'orders',eligible);
end $function$
;
