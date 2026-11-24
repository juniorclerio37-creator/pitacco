create table if not exists pitacco_private.pizza_catalog (
 product_id uuid primary key references public.products(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 draft_id uuid not null unique references public.pitacco_pizza_drafts(id) on delete restrict,
 config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<=262144),
 updated_at timestamptz not null default now()
);
alter table pitacco_private.pizza_catalog enable row level security;
revoke all on pitacco_private.pizza_catalog from public,anon,authenticated;
create or replace function pitacco_private.pizza_checkout_options(p_store uuid,p_product uuid,p_options jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb; p numeric; chosen text[]; size_ids text[]; flavors jsonb; extras jsonb; q jsonb; mods jsonb; normalized jsonb;
begin
 select pc.config,pr.price into c,p from pitacco_private.pizza_catalog pc join public.products pr on pr.id=pc.product_id and pr.store_id=pc.store_id where pc.product_id=p_product and pc.store_id=p_store and pr.menu_active;
 if not found or p<>0 then raise exception 'Pizza indisponível';end if;
 if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) not between 2 and 100 then raise exception 'Montagem inválida';end if;
 if exists(select 1 from jsonb_array_elements(p_options) v where jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Opção inválida';end if;
 select array_agg(v order by v) into chosen from jsonb_array_elements_text(p_options) v;
 if cardinality(chosen)<>(select count(distinct v) from unnest(chosen) v) then raise exception 'Opção repetida';end if;
 normalized:=public.pitacco_normalize_pizza_draft(c);
 select array_agg(v->>'id') into size_ids from jsonb_array_elements(normalized->'sizes') v where (v->>'id')=any(chosen);
 if coalesce(cardinality(size_ids),0)<>1 then raise exception 'Escolha exatamente um tamanho';end if;
 select coalesce(jsonb_agg(v->>'id' order by v->>'id'),'[]') into flavors from jsonb_array_elements(normalized->'flavors') v where (v->>'id')=any(chosen);
 select coalesce(jsonb_agg(v->>'id' order by v->>'id'),'[]') into extras from jsonb_array_elements(normalized->'extras') v where (v->>'id')=any(chosen);
 if cardinality(chosen)<>1+jsonb_array_length(flavors)+jsonb_array_length(extras) then raise exception 'Opção não pertence à pizza';end if;
 q:=public.pitacco_quote_pizza_config(c,size_ids[1],flavors,extras);
 mods:=jsonb_build_array(jsonb_build_object('option_id',size_ids[1],'group','Tamanho','name',q->>'size_name','price',(q->>'base_cents')::numeric/100));
 select mods||coalesce(jsonb_agg(jsonb_build_object('option_id',v->>'id','group',v->>'kind','name',v->>'name','price',coalesce((v->>'price_cents')::numeric,0)/100,'numerator',v->'numerator','denominator',v->'denominator')),'[]') into mods from jsonb_array_elements(q->'modifiers') v;
 return jsonb_build_object('modifiers',mods,'extra',(q->>'total_cents')::numeric/100,'canonical',to_jsonb(chosen));
end $$;
revoke all on function pitacco_private.pizza_checkout_options(uuid,uuid,jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_public_menu(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare cfg public.public_menu_settings%rowtype; items jsonb; begin
 select * into cfg from public.public_menu_settings where slug=p_slug and enabled;if not found then raise exception 'Cardapio indisponivel';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'description',p.description,'image_url',p.image_url,'option_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'required',g.min_select>0,'min',g.min_select,'max',g.max_select,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'price',o.additional_price,'image_url',o.image_url) order by o.sort_order,o.name) from public.product_options o where o.group_id=g.id and o.available),'[]'::jsonb)) order by g.sort_order,g.name) from public.product_option_groups g where g.product_id=p.id and g.enabled),'[]'::jsonb)) || coalesce((select jsonb_build_object('pizza_config',public.pitacco_normalize_pizza_draft(pc.config)) from pitacco_private.pizza_catalog pc where pc.product_id=p.id and pc.store_id=p.store_id),'{}'::jsonb) order by coalesce((select co.sort_order from public.pitacco_menu_category_order co where co.store_id=cfg.store_id and co.category=coalesce(nullif(btrim(p.category),''),'Outros')),2147480000),coalesce(nullif(btrim(p.category),''),'Outros'),p.sort_order,p.name,p.id),'[]') into items from public.products p where p.store_id=cfg.store_id and p.menu_active;
 return jsonb_build_object('store',jsonb_build_object('name',(select name from public.stores where id=cfg.store_id),'slug',cfg.slug,'route_pricing',(select jsonb_build_object('enabled',r.enabled,'max_radius_km',r.max_radius_km,'mode',r.coverage_type)
   from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled),
  'delivery_area',(select jsonb_build_object('latitude',s.latitude,'longitude',s.longitude,
   'radius_m',r.max_radius_km*1000,'coverage_type',r.coverage_type,'polygon',r.polygon,'polygons',r.polygons)
   from public.pitacco_delivery_pricing r join public.stores s on s.id=r.store_id
   where r.store_id=cfg.store_id and r.enabled and cfg.delivery_enabled),'logo_url',(select logo_url from public.store_customer_branding where store_id=cfg.store_id),'secondary_color',coalesce((select secondary_color from public.store_customer_branding where store_id=cfg.store_id),'#6d145f'),'banner_url',(select banner_url from public.store_customer_branding where store_id=cfg.store_id),'primary_color',coalesce((select primary_color from public.store_customer_branding where store_id=cfg.store_id),'#db482f'),'category_icons',coalesce(cfg.category_icons,'{}'::jsonb),'appearance',pitacco_private.storefront_public_design(cfg.store_id),'profile_logo_path',(select to_jsonb(profile_store)->>'logo_path' from public.stores profile_store where id=cfg.store_id),'opening_hours',pitacco_private.store_opening_status(cfg.store_id,now()),'delivery_enabled',(cfg.delivery_enabled and exists (select 1 from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled)),'pickup_enabled',cfg.pickup_enabled,'delivery_fee',0,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $function$;
CREATE OR REPLACE FUNCTION public.pitacco_validate_item_options(p_store uuid, p_product uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare grp record;opt record;entry jsonb;chosen uuid[]:=array[]::uuid[];selected_count int;extra numeric:=0;mods jsonb:='[]'::jsonb;canonical jsonb:='[]'::jsonb; pizza_result jsonb;begin
if exists(select 1 from pitacco_private.pizza_catalog pc where pc.product_id=p_product) then
 return pitacco_private.pizza_checkout_options(p_store,p_product,p_options);
end if;
if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options)>100 then raise exception 'Complementos inválidos';end if;
for entry in select value from jsonb_array_elements(p_options) loop
if jsonb_typeof(entry)<>'string' or (entry#>>'{}') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Complemento inválido';end if;
if (entry#>>'{}')::uuid=any(chosen) then raise exception 'Complemento repetido';end if;
chosen:=array_append(chosen,(entry#>>'{}')::uuid);
end loop;
for grp in select * from public.product_option_groups where store_id=p_store and product_id=p_product order by sort_order,id loop
select count(*) into selected_count from public.product_options o where o.group_id=grp.id and o.id=any(chosen) and o.available;
if selected_count<grp.min_select or selected_count>grp.max_select then raise exception 'Quantidade de escolhas inválida no grupo %',grp.name;end if;
end loop;
for opt in select o.*,g.name as group_name from public.product_options o join public.product_option_groups g on g.id=o.group_id where o.id=any(chosen) and o.store_id=p_store and g.product_id=p_product and o.available order by g.sort_order,g.id,o.sort_order,o.id loop
extra:=extra+opt.additional_price;
mods:=mods||jsonb_build_array(jsonb_build_object('option_id',opt.id,'group',opt.group_name,'name',opt.name,'price',opt.additional_price));
canonical:=canonical||jsonb_build_array(opt.id::text);
end loop;
if jsonb_array_length(canonical)<>cardinality(chosen) then raise exception 'Complemento indisponível ou pertencente a outro produto';end if;
return jsonb_build_object('modifiers',mods,'extra',extra,'canonical',canonical);
end $function$;

