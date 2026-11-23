-- Ordenação independente por loja. Nenhuma atualização apaga produtos, complementos ou pedidos.
alter table public.products add column if not exists sort_order integer not null default 0;
alter table public.pitacco_complement_templates add column if not exists sort_order integer not null default 0;
create index if not exists pitacco_product_order on public.products(store_id,category,sort_order);
create index if not exists pitacco_group_order on public.product_option_groups(store_id,product_id,sort_order);
create index if not exists pitacco_option_order on public.product_options(store_id,group_id,sort_order);
create table if not exists public.pitacco_menu_category_order(
 store_id uuid not null references public.stores(id) on delete cascade,
 category text not null check(length(btrim(category)) between 1 and 180),
 sort_order integer not null default 0,
 updated_at timestamptz not null default now(),
 primary key(store_id,category)
);
alter table public.pitacco_menu_category_order enable row level security;
drop policy if exists pitacco_menu_category_order_select on public.pitacco_menu_category_order;
create policy pitacco_menu_category_order_select on public.pitacco_menu_category_order
 for select to authenticated using(public.pitacco_menu_import_allowed(store_id));
revoke all on public.pitacco_menu_category_order from public,anon,authenticated;
grant select on public.pitacco_menu_category_order to authenticated;

-- A função executa em uma transação. Exige permissão da loja e valida TODOS os IDs
-- contra a categoria/produto/grupo selecionados antes de atualizar a sequência.
create or replace function public.pitacco_catalog_reorder(
 p_store uuid, p_kind text, p_ids uuid[] default null, p_parent uuid default null,
 p_category text default null, p_categories text[] default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_ids uuid[]:=coalesce(p_ids,array[]::uuid[]);
 v_categories text[]:=coalesce(p_categories,array[]::text[]);
 v_count integer; v_id uuid; v_cat text; v_rank integer:=0; v_limit integer:=2000;
begin
 if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store) then
  raise exception 'Sem permissão para organizar o cardápio desta loja';
 end if;
 if p_kind not in ('categories','products','groups','options','templates') then
  raise exception 'Tipo de ordenação inválido';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,647221));
 if p_kind='categories' then
  if cardinality(v_categories)>v_limit or exists(select 1 from unnest(v_categories) x where x is null or length(btrim(x))<1 or length(btrim(x))>180) then raise exception 'Categorias inválidas';end if;
  if cardinality(v_categories)<>(select count(distinct x) from unnest(v_categories) x) then raise exception 'Categorias duplicadas';end if;
  select count(*) into v_count from (
   select distinct coalesce(nullif(btrim(category),''),'Outros') category
   from public.products where store_id=p_store
  ) x;
  if cardinality(v_categories)<>v_count or
    exists(select coalesce(nullif(btrim(category),''),'Outros') from public.products where store_id=p_store
       except select x from unnest(v_categories) x) then
    raise exception 'Recarregue as categorias antes de ordená-las';
  end if;
  foreach v_cat in array v_categories loop
   v_rank:=v_rank+10;
   insert into public.pitacco_menu_category_order(store_id,category,sort_order,updated_at)
   values(p_store,v_cat,v_rank,now())
   on conflict(store_id,category) do update set sort_order=excluded.sort_order,updated_at=now();
  end loop;
  return jsonb_build_object('saved',true,'kind',p_kind,'count',v_rank/10);
 end if;
 if cardinality(v_ids)>v_limit or cardinality(v_ids)=0 or
    cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) id) then
  raise exception 'A lista de itens deve conter IDs válidos e sem repetições';
 end if;
 if p_kind='products' then
  if p_category is null then raise exception 'Categoria obrigatória';end if;
  select count(*) into v_count from public.products p where p.store_id=p_store
    and coalesce(nullif(btrim(p.category),''),'Outros')=p_category;
  if v_count<>cardinality(v_ids) or
   (select count(*) from public.products p where p.store_id=p_store and p.id=any(v_ids)
    and coalesce(nullif(btrim(p.category),''),'Outros')=p_category)<>v_count then
   raise exception 'A lista de produtos da categoria mudou. Recarregue a página';
  end if;
 elsif p_kind='groups' then
  if p_parent is null then raise exception 'Produto obrigatório';end if;
  select count(*) into v_count from public.product_option_groups g where g.store_id=p_store and g.product_id=p_parent;
  if v_count<>cardinality(v_ids) or
   (select count(*) from public.product_option_groups g where g.store_id=p_store and g.product_id=p_parent
    and g.id=any(v_ids))<>v_count then
   raise exception 'A lista de grupos mudou. Recarregue a página';
  end if;
 elsif p_kind='options' then
  if p_parent is null then raise exception 'Grupo obrigatório';end if;
  select count(*) into v_count from public.product_options o where o.store_id=p_store and o.group_id=p_parent;
  if v_count<>cardinality(v_ids) or
   (select count(*) from public.product_options o where o.store_id=p_store and o.group_id=p_parent
    and o.id=any(v_ids))<>v_count then
   raise exception 'A lista de complementos mudou. Recarregue a página';
  end if;
 elsif p_kind='templates' then
  select count(*) into v_count from public.pitacco_complement_templates t where t.store_id=p_store;
  if v_count<>cardinality(v_ids) or
   (select count(*) from public.pitacco_complement_templates t where t.store_id=p_store
    and t.id=any(v_ids))<>v_count then
   raise exception 'A lista de modelos mudou. Recarregue a página';
  end if;
 end if;
 foreach v_id in array v_ids loop
  v_rank:=v_rank+10;
  if p_kind='products' then
   update public.products set sort_order=v_rank where id=v_id and store_id=p_store;
  elsif p_kind='groups' then
   update public.product_option_groups set sort_order=v_rank where id=v_id and store_id=p_store;
  elsif p_kind='options' then
   update public.product_options set sort_order=v_rank where id=v_id and store_id=p_store;
  elsif p_kind='templates' then
   update public.pitacco_complement_templates set sort_order=v_rank,updated_at=now()
    where id=v_id and store_id=p_store;
  end if;
 end loop;
 return jsonb_build_object('saved',true,'kind',p_kind,'count',v_rank/10);
end;
$$;
revoke all on function public.pitacco_catalog_reorder(uuid,text,uuid[],uuid,text,text[]) from public,anon;
grant execute on function public.pitacco_catalog_reorder(uuid,text,uuid[],uuid,text,text[]) to authenticated;

-- Lista pública deve respeitar: categorias -> produtos -> grupos -> complementos.
-- Grupos e complementos já utilizam sort_order; ajustamos apenas categorias e produtos.

CREATE OR REPLACE FUNCTION public.get_public_menu(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare cfg public.public_menu_settings%rowtype; items jsonb; begin
 select * into cfg from public.public_menu_settings where slug=p_slug and enabled;if not found then raise exception 'Cardapio indisponivel';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'description',p.description,'image_url',p.image_url,'option_groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'required',g.min_select>0,'min',g.min_select,'max',g.max_select,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'price',o.additional_price,'image_url',o.image_url) order by o.sort_order,o.name) from public.product_options o where o.group_id=g.id and o.available),'[]'::jsonb)) order by g.sort_order,g.name) from public.product_option_groups g where g.product_id=p.id and g.enabled),'[]'::jsonb)) order by coalesce((select co.sort_order from public.pitacco_menu_category_order co where co.store_id=cfg.store_id and co.category=coalesce(nullif(btrim(p.category),''),'Outros')),2147480000),coalesce(nullif(btrim(p.category),''),'Outros'),p.sort_order,p.name,p.id),'[]') into items from public.products p where p.store_id=cfg.store_id and p.menu_active;
 return jsonb_build_object('store',jsonb_build_object('name',(select name from public.stores where id=cfg.store_id),'slug',cfg.slug,'route_pricing',(select jsonb_build_object('enabled',r.enabled,'max_radius_km',r.max_radius_km,'mode',r.coverage_type)
   from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled),
  'delivery_area',(select jsonb_build_object('latitude',s.latitude,'longitude',s.longitude,
   'radius_m',r.max_radius_km*1000,'coverage_type',r.coverage_type,'polygon',r.polygon,'polygons',r.polygons)
   from public.pitacco_delivery_pricing r join public.stores s on s.id=r.store_id
   where r.store_id=cfg.store_id and r.enabled and cfg.delivery_enabled),'logo_url',(select logo_url from public.store_customer_branding where store_id=cfg.store_id),'secondary_color',coalesce((select secondary_color from public.store_customer_branding where store_id=cfg.store_id),'#6d145f'),'banner_url',(select banner_url from public.store_customer_branding where store_id=cfg.store_id),'primary_color',coalesce((select primary_color from public.store_customer_branding where store_id=cfg.store_id),'#db482f'),'category_icons',coalesce(cfg.category_icons,'{}'::jsonb),'appearance',pitacco_private.storefront_public_design(cfg.store_id),'profile_logo_path',(select to_jsonb(profile_store)->>'logo_path' from public.stores profile_store where id=cfg.store_id),'opening_hours',pitacco_private.store_opening_status(cfg.store_id,now()),'delivery_enabled',(cfg.delivery_enabled and exists (select 1 from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled)),'pickup_enabled',cfg.pickup_enabled,'delivery_fee',0,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $function$;
