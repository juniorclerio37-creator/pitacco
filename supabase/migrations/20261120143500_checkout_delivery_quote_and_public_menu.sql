-- Public storefront displays delivery only when a valid area is active.
-- Orders use a server-generated quote; the destination pin is preserved for
-- rider navigation and confirmed from the same immutable quote.
CREATE OR REPLACE FUNCTION public.get_public_menu(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare cfg public.public_menu_settings%rowtype; items jsonb; begin
 select * into cfg from public.public_menu_settings where slug=p_slug and enabled;if not found then raise exception 'Cardapio indisponivel';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'description',p.description,'image_url',p.image_url,'option_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'required',g.min_select>0,'min',g.min_select,'max',g.max_select,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'price',o.additional_price) order by o.sort_order,o.name) from public.product_options o where o.group_id=g.id and o.available),'[]'::jsonb)) order by g.sort_order,g.name) from public.product_option_groups g where g.product_id=p.id),'[]'::jsonb)) order by p.category,p.name,p.id),'[]') into items from public.products p where p.store_id=cfg.store_id and p.menu_active;
 return jsonb_build_object('store',jsonb_build_object('name',(select name from public.stores where id=cfg.store_id),'slug',cfg.slug,'route_pricing',(select jsonb_build_object('enabled',r.enabled,'max_radius_km',r.max_radius_km,'mode',r.coverage_type)
   from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled),
  'delivery_area',(select jsonb_build_object('latitude',s.latitude,'longitude',s.longitude,
   'radius_m',r.max_radius_km*1000,'coverage_type',r.coverage_type,'polygon',r.polygon)
   from public.pitacco_delivery_pricing r join public.stores s on s.id=r.store_id
   where r.store_id=cfg.store_id and r.enabled and cfg.delivery_enabled),'logo_url',(select logo_url from public.store_customer_branding where store_id=cfg.store_id),'secondary_color',coalesce((select secondary_color from public.store_customer_branding where store_id=cfg.store_id),'#6d145f'),'banner_url',(select banner_url from public.store_customer_branding where store_id=cfg.store_id),'primary_color',coalesce((select primary_color from public.store_customer_branding where store_id=cfg.store_id),'#db482f'),'appearance',pitacco_private.storefront_public_design(cfg.store_id),'profile_logo_path',(select to_jsonb(profile_store)->>'logo_path' from public.stores profile_store where id=cfg.store_id),'opening_hours',pitacco_private.store_opening_status(cfg.store_id,now()),'delivery_enabled',(cfg.delivery_enabled and exists (select 1 from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled)),'pickup_enabled',cfg.pickup_enabled,'delivery_fee',0,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $function$
;
CREATE OR REPLACE FUNCTION public.pitacco_checkout_quoted_delivery(p_slug text, p_request uuid, p_customer text, p_phone text, p_address text, p_items jsonb, p_fulfillment text, p_payment text, p_notes text, p_quote uuid, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb;
 v_lat double precision;v_lng double precision;
begin
 if p_quote is null or p_fulfillment<>'delivery' then raise exception 'Cotação de entrega obrigatória'; end if;

 select destination_latitude,destination_longitude into v_lat,v_lng
 from public.pitacco_delivery_route_quotes
 where id=p_quote and request_id=p_request and destination_address=trim(p_address);
 if v_lat is null or v_lng is null then raise exception 'Recalcule a localização do frete';end if;
 perform set_config('pitacco.checkout_delivery_quote',p_quote::text,true);
 perform set_config('pitacco.checkout_delivery_point',
  jsonb_build_object('latitude',v_lat,'longitude',v_lng)::text,true);
 if p_scheduled_for is null then
  result:=public.checkout_public_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes);
 else
  result:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,p_scheduled_for);
 end if;
 perform set_config('pitacco.checkout_delivery_quote','',true);
 perform set_config('pitacco.checkout_delivery_point','',true);
 return result;
end $function$
;
