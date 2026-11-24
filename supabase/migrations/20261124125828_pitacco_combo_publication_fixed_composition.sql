create or replace function pitacco_private.combo_public_info(p_store uuid,p_product uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c pitacco_private.combo_catalog%rowtype; q jsonb; v_price numeric; v_description text;
begin
 select * into c from pitacco_private.combo_catalog cc where cc.store_id=p_store and cc.product_id=p_product;
 if not found then return null;end if;
 select price into v_price from public.products where store_id=p_store and id=p_product and menu_active;
 if not found then return null;end if;
 begin
  q:=pitacco_private.quote_pizza_combo(p_store,c.items,c.rule,c.value);
 exception when raise_exception then return null;
 end;
 if v_price<>(q->>'total_cents')::numeric/100 then return null;end if;
 select string_agg((v->>'quantity')||'x '||(v->>'name')||coalesce((select ' ('||string_agg(m->>'name',', ')||')' from jsonb_array_elements(v->'modifiers') m having count(*)>0),''),' + ') into v_description from jsonb_array_elements(q->'items') v;
 return jsonb_build_object('combo_fixed',true,'description',left(v_description,1200));
end $$;
revoke all on function pitacco_private.combo_public_info(uuid,uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_public_menu(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare cfg public.public_menu_settings%rowtype; items jsonb; begin
 select * into cfg from public.public_menu_settings where slug=p_slug and enabled;if not found then raise exception 'Cardapio indisponivel';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'description',p.description,'image_url',p.image_url,'option_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'required',g.min_select>0,'min',g.min_select,'max',g.max_select,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'price',o.additional_price,'image_url',o.image_url) order by o.sort_order,o.name) from public.product_options o where o.group_id=g.id and o.available),'[]'::jsonb)) order by g.sort_order,g.name) from public.product_option_groups g where g.product_id=p.id and g.enabled),'[]'::jsonb)) || coalesce((select jsonb_build_object('pizza_config',public.pitacco_normalize_pizza_draft(pc.config)) from pitacco_private.pizza_catalog pc where pc.product_id=p.id and pc.store_id=p.store_id),'{}'::jsonb) || coalesce((select pitacco_private.combo_public_info(p.store_id,p.id) from pitacco_private.combo_catalog cc where cc.product_id=p.id and cc.store_id=p.store_id),'{}'::jsonb) order by coalesce((select co.sort_order from public.pitacco_menu_category_order co where co.store_id=cfg.store_id and co.category=coalesce(nullif(btrim(p.category),''),'Outros')),2147480000),coalesce(nullif(btrim(p.category),''),'Outros'),p.sort_order,p.name,p.id),'[]') into items from public.products p where p.store_id=cfg.store_id and p.menu_active and (not exists(select 1 from pitacco_private.combo_catalog cc where cc.product_id=p.id) or pitacco_private.combo_public_info(p.store_id,p.id) is not null);
 return jsonb_build_object('store',jsonb_build_object('name',(select name from public.stores where id=cfg.store_id),'slug',cfg.slug,'route_pricing',(select jsonb_build_object('enabled',r.enabled,'max_radius_km',r.max_radius_km,'mode',r.coverage_type)
   from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled),
  'delivery_area',(select jsonb_build_object('latitude',s.latitude,'longitude',s.longitude,
   'radius_m',r.max_radius_km*1000,'coverage_type',r.coverage_type,'polygon',r.polygon,'polygons',r.polygons)
   from public.pitacco_delivery_pricing r join public.stores s on s.id=r.store_id
   where r.store_id=cfg.store_id and r.enabled and cfg.delivery_enabled),'logo_url',(select logo_url from public.store_customer_branding where store_id=cfg.store_id),'secondary_color',coalesce((select secondary_color from public.store_customer_branding where store_id=cfg.store_id),'#6d145f'),'banner_url',(select banner_url from public.store_customer_branding where store_id=cfg.store_id),'primary_color',coalesce((select primary_color from public.store_customer_branding where store_id=cfg.store_id),'#db482f'),'category_icons',coalesce(cfg.category_icons,'{}'::jsonb),'appearance',pitacco_private.storefront_public_design(cfg.store_id),'profile_logo_path',(select to_jsonb(profile_store)->>'logo_path' from public.stores profile_store where id=cfg.store_id),'opening_hours',pitacco_private.store_opening_status(cfg.store_id,now()),'delivery_enabled',(cfg.delivery_enabled and exists (select 1 from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled)),'pickup_enabled',cfg.pickup_enabled,'delivery_fee',0,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $function$;
create or replace function public.pitacco_publish_combo(p_store uuid,p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q jsonb; pid uuid;
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 q:=public.pitacco_stage_combo(p_store,p_draft);pid:=(q->>'product_id')::uuid;
 update public.products set menu_active=true where id=pid and store_id=p_store;
 if pitacco_private.combo_public_info(p_store,pid) is null then raise exception 'Não foi possível publicar a composição';end if;
 return q||jsonb_build_object('published',true,'active',true);
end $$;
revoke all on function public.pitacco_publish_combo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_publish_combo(uuid,uuid) to authenticated;
create or replace function public.pitacco_combo_publication_status(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('draft_id',cc.draft_id,'product_id',cc.product_id,'active',p.menu_active,'available',pitacco_private.combo_public_info(p_store,p.id) is not null)) from pitacco_private.combo_catalog cc join public.products p on p.id=cc.product_id and p.store_id=cc.store_id where cc.store_id=p_store),'[]');
end $$;
revoke all on function public.pitacco_combo_publication_status(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_combo_publication_status(uuid) to authenticated;
create or replace function public.pitacco_deactivate_combo(p_store uuid,p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 select product_id into pid from pitacco_private.combo_catalog where store_id=p_store and draft_id=p_draft;
 if not found then raise exception 'Combo indisponível';end if;
 update public.products set menu_active=false where id=pid and store_id=p_store;
 return jsonb_build_object('active',false,'product_id',pid);
end $$;
revoke all on function public.pitacco_deactivate_combo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_deactivate_combo(uuid,uuid) to authenticated;

