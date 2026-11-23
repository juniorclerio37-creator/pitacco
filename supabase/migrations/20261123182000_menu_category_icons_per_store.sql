-- Category icon settings are per store, with no global effects on other shops.
alter table public.public_menu_settings
 add column if not exists category_icons jsonb not null default '{}'::jsonb;
comment on column public.public_menu_settings.category_icons is
 'Mapa de categoria exata -> chave de ícone escolhida pelo lojista.';

create or replace function public.pitacco_menu_category_icons_state(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $category$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Apenas gestores podem editar categorias' using errcode='42501';
 end if;
 return coalesce((select category_icons from public.public_menu_settings where store_id=p_store),'{}'::jsonb);
end $category$;

create or replace function public.pitacco_menu_category_set_icon(
 p_store uuid,p_category text,p_icon text
) returns jsonb language plpgsql security definer set search_path='' as $category$
declare saved jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Apenas gestores podem editar categorias' using errcode='42501';
 end if;
 if p_category is null or length(btrim(p_category)) not between 1 and 120 then
  raise exception 'Categoria inválida';
 end if;
 if p_icon is null or p_icon <> all(array['flame','star','discount','crown','trophy','tag','megaphone','acai','ice-cream-cone','ice-cream-cup','dessert','combo-burger','combo-pizza','combo-acai','combo-ice-cream','combo-meal','combo-mixed','pizza-slice','pizza-whole','pizza-sweet','meal-box','plate','meal','buffet','pf','healthy','homemade','burger','snack','sandwich','hot-dog','soda','juice','energy','beer','water','drink','fries','appetizer','rings','board','plus','cheese','sauce','spice','calendar','more','pizza']) then
  raise exception 'Ícone não permitido';
 end if;
 if not exists(select 1 from public.products where store_id=p_store and btrim(category)=btrim(p_category)) then
  raise exception 'Categoria não encontrada nesta loja';
 end if;
 update public.public_menu_settings
 set category_icons=coalesce(category_icons,'{}'::jsonb)||jsonb_build_object(btrim(p_category),p_icon)
 where store_id=p_store
 returning category_icons into saved;
 if not found then
  raise exception 'Configure o cardápio público da loja antes de escolher os ícones';
 end if;
 return jsonb_build_object('saved',true,'category',btrim(p_category),'icon',p_icon);
end $category$;

revoke all on function public.pitacco_menu_category_icons_state(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_menu_category_icons_state(uuid) to authenticated;
revoke all on function public.pitacco_menu_category_set_icon(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_menu_category_set_icon(uuid,text,text) to authenticated;

-- Public cardápio only sees these visual keys (not store manager data).
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
   'radius_m',r.max_radius_km*1000,'coverage_type',r.coverage_type,'polygon',r.polygon,'polygons',r.polygons)
   from public.pitacco_delivery_pricing r join public.stores s on s.id=r.store_id
   where r.store_id=cfg.store_id and r.enabled and cfg.delivery_enabled),'logo_url',(select logo_url from public.store_customer_branding where store_id=cfg.store_id),'secondary_color',coalesce((select secondary_color from public.store_customer_branding where store_id=cfg.store_id),'#6d145f'),'banner_url',(select banner_url from public.store_customer_branding where store_id=cfg.store_id),'primary_color',coalesce((select primary_color from public.store_customer_branding where store_id=cfg.store_id),'#db482f'),'category_icons',coalesce(cfg.category_icons,'{}'::jsonb),'appearance',pitacco_private.storefront_public_design(cfg.store_id),'profile_logo_path',(select to_jsonb(profile_store)->>'logo_path' from public.stores profile_store where id=cfg.store_id),'opening_hours',pitacco_private.store_opening_status(cfg.store_id,now()),'delivery_enabled',(cfg.delivery_enabled and exists (select 1 from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled)),'pickup_enabled',cfg.pickup_enabled,'delivery_fee',0,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $function$
;
