-- Super Admin: cópia transacional de catálogo e criação de estabelecimento independente.
create table pitacco_private.owner_catalog_copy_requests(
 request_id uuid primary key, actor uuid not null, source_id uuid not null,
 target_id uuid not null, result jsonb not null
);
alter table pitacco_private.owner_catalog_copy_requests enable row level security;
revoke all on pitacco_private.owner_catalog_copy_requests from public,anon,authenticated;
-- Deterministic destination paths allow a safe retry after an interrupted upload.
create function pitacco_private.owner_copy_media_path(p_dest uuid,p_request uuid,p_path text)
returns text language sql immutable set search_path='' as $$
 select 'stores/'||p_dest||'/'||(md5(p_request::text||p_path)::uuid)::text||'.'||split_part(p_path,'.',2)
$$;
revoke all on function pitacco_private.owner_copy_media_path(uuid,uuid,text) from public,anon,authenticated;
create function public.pitacco_owner_copy_media_manifest(p_source uuid,p_target uuid,p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare dest uuid:=coalesce(p_target,p_request); d jsonb;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Acesso exclusivo do Super Admin' using errcode='42501';end if;
 if p_source is null or p_request is null or dest=p_source or (p_target is not null and not exists(select 1 from public.stores where id=dest)) then raise exception 'Destino inválido';end if;
 if p_target is not null and exists(select 1 from public.products where store_id=dest) and not exists(select 1 from pitacco_private.owner_catalog_copy_requests where request_id=p_request and actor=auth.uid() and source_id=p_source and target_id=dest) then raise exception 'O destino precisa ter catálogo vazio';end if;
 select published into d from public.pitacco_storefront_designs where store_id=p_source;
 return coalesce((select jsonb_agg(jsonb_build_object('source',path,'target',pitacco_private.owner_copy_media_path(dest,p_request,path),'exists',exists(select 1 from storage.objects where bucket_id='pitacco-media' and name=pitacco_private.owner_copy_media_path(dest,p_request,path)))) from (select d->>'cover_path' as path union select value->>'image_path' from jsonb_array_elements(coalesce(d->'banners','[]'))) m where coalesce(path,'')<>''),'[]');
end $$;
revoke all on function public.pitacco_owner_copy_media_manifest(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_copy_media_manifest(uuid,uuid,uuid) to authenticated;
create function public.pitacco_owner_copy_catalog(p_source uuid,p_target uuid,p_new_name text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare dest uuid:=coalesce(p_target,p_request); pr record; gr record; opt record; pizza record; draft record; new_product uuid; new_group uuid; new_draft uuid; product_count int:=0; group_count int:=0; option_count int:=0; pizza_count int:=0; old_result record; result jsonb; source_name text; ids jsonb:='{}'; option_ids jsonb:='{}'; template_ids jsonb:='{}'; library_ids jsonb:='{}'; tpl record; item jsonb; opts jsonb; new_option uuid; new_template uuid; combo record; published_combo record; new_combo uuid; combo_items jsonb; design jsonb; target_design jsonb; banners jsonb; media record; revision integer; combo_count integer:=0; 
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Acesso exclusivo do Super Admin' using errcode='42501';end if;
 if p_source is null or p_request is null or (p_target is null and coalesce(length(btrim(p_new_name)),0) not between 3 and 100) or (p_target is not null and p_new_name is not null) or p_target=p_source then raise exception 'Origem ou destino inválido';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old_result from pitacco_private.owner_catalog_copy_requests where request_id=p_request;
 if found then
  if old_result.actor<>auth.uid() or old_result.source_id<>p_source or (p_target is not null and old_result.target_id<>p_target) then raise exception 'Solicitação já utilizada';end if;
  return old_result.result;
 end if;
 -- Serializa cópias entre as mesmas lojas, com ordem estável de bloqueio.
 perform 1 from public.stores where id in (p_source,p_target) order by id for update;
 select name into source_name from public.stores where id=p_source;
 if not found then raise exception 'Loja de origem não encontrada';end if;
 if p_target is null then
  insert into public.stores(id,name,platform,plan) values(dest,btrim(p_new_name),'delivery proprio','saas');
  update public.public_menu_settings set enabled=false where store_id=dest;
 elsif not exists(select 1 from public.stores where id=dest) then raise exception 'Loja de destino não encontrada';end if;
 -- A cópia fiel exige catálogo vazio: jamais mesclar ou apagar itens existentes.
 if exists(select 1 from public.products where store_id=dest) or exists(select 1 from public.pitacco_complement_templates where store_id=dest) or exists(select 1 from public.pitacco_pizza_drafts where store_id=dest) or exists(select 1 from public.pitacco_combo_drafts where store_id=dest) then raise exception 'O destino precisa ter catálogo vazio. Nenhum dado foi alterado';end if;
 for tpl in select * from public.pitacco_complement_templates where store_id=p_source order by sort_order,id loop
  opts:='[]';
  for item in select value from jsonb_array_elements(tpl.options) loop
   new_option:=gen_random_uuid();library_ids:=library_ids||jsonb_build_object(item->>'id',new_option);
   opts:=opts||jsonb_build_array(jsonb_set(item,'{id}',to_jsonb(new_option)));
  end loop;
  insert into public.pitacco_complement_templates(store_id,name,min_select,max_select,options,sort_order) values(dest,tpl.name,tpl.min_select,tpl.max_select,opts,tpl.sort_order) returning id into new_template;
  template_ids:=template_ids||jsonb_build_object(tpl.id::text,new_template);
 end loop;
 for pr in select * from public.products where store_id=p_source order by sort_order,id loop
  insert into public.products(store_id,name,category,description,price,cost,menu_active,image_url,sealed_industrial_beverage,sort_order)
   values(dest,pr.name,pr.category,pr.description,pr.price,0,pr.menu_active,pr.image_url,pr.sealed_industrial_beverage,pr.sort_order) returning id into new_product;
  ids:=ids||jsonb_build_object(pr.id::text,new_product);
  product_count:=product_count+1;
  for gr in select * from public.product_option_groups where store_id=p_source and product_id=pr.id order by sort_order,id loop
   insert into public.product_option_groups(store_id,product_id,name,min_select,max_select,sort_order,enabled,library_template_id)
    values(dest,new_product,gr.name,gr.min_select,gr.max_select,gr.sort_order,gr.enabled,(template_ids->>gr.library_template_id::text)::uuid) returning id into new_group;
   group_count:=group_count+1;
   for opt in select * from public.product_options where store_id=p_source and group_id=gr.id order by sort_order,id loop
    insert into public.product_options(store_id,group_id,name,additional_price,available,sort_order,image_url,library_option_id)
     values(dest,new_group,opt.name,opt.additional_price,opt.available,opt.sort_order,opt.image_url,(library_ids->>opt.library_option_id::text)::uuid) returning id into new_option;
    option_ids:=option_ids||jsonb_build_object(opt.id::text,new_option);
    option_count:=option_count+1;
   end loop;
  end loop;
  select * into pizza from pitacco_private.pizza_catalog where store_id=p_source and product_id=pr.id;
  if found then
   select * into draft from public.pitacco_pizza_drafts where store_id=p_source and id=pizza.draft_id;
   if not found then raise exception 'Cadastro de pizza de origem incompleto';end if;
   insert into public.pitacco_pizza_drafts(store_id,name,config) values(dest,draft.name,draft.config) returning id into new_draft;
   insert into pitacco_private.pizza_catalog(store_id,product_id,draft_id,config) values(dest,new_product,new_draft,pizza.config);
   pizza_count:=pizza_count+1;
  end if;
 end loop;
 insert into public.pitacco_pizza_drafts(store_id,name,config)
 select dest,d.name,d.config from public.pitacco_pizza_drafts d where d.store_id=p_source and not exists(select 1 from pitacco_private.pizza_catalog pc where pc.store_id=p_source and pc.draft_id=d.id);
 -- Remapeia componentes e complementos de combos; opções internas de pizza são locais à configuração.
 for combo in select * from public.pitacco_combo_drafts where store_id=p_source loop
  combo_items:='[]';
  for item in select value from jsonb_array_elements(combo.items) loop
   if not ids ? (item->>'product_id') then raise exception 'Combo de origem contém produto ausente';end if;
   select coalesce(jsonb_agg(coalesce(option_ids->v,to_jsonb(v)) order by ord),'[]') into opts from jsonb_array_elements_text(item->'options') with ordinality as o(v,ord);
   combo_items:=combo_items||jsonb_build_array(item||jsonb_build_object('product_id',ids->(item->>'product_id'),'options',opts));
  end loop;
  insert into public.pitacco_combo_drafts(store_id,name,items,rule,value) values(dest,combo.name,combo_items,combo.rule,combo.value) returning id into new_combo;
  for published_combo in select * from pitacco_private.combo_catalog cc where cc.store_id=p_source and cc.draft_id=combo.id loop
   combo_items:='[]';
   for item in select value from jsonb_array_elements(published_combo.items) loop
    if not ids ? (item->>'product_id') then raise exception 'Combo publicado contém produto ausente';end if;
    select coalesce(jsonb_agg(coalesce(option_ids->v,to_jsonb(v)) order by ord),'[]') into opts from jsonb_array_elements_text(item->'options') with ordinality as o(v,ord);
    combo_items:=combo_items||jsonb_build_array(item||jsonb_build_object('product_id',ids->(item->>'product_id'),'options',opts));
   end loop;
   insert into pitacco_private.combo_catalog(product_id,store_id,draft_id,items,rule,value) values((ids->>published_combo.product_id::text)::uuid,dest,new_combo,combo_items,published_combo.rule,published_combo.value);
  end loop;
  combo_count:=combo_count+1;
 end loop;
 insert into public.pitacco_pizza_flavor_library(store_id,name,description,ingredients,image_url,category,available)
 select dest,name,description,ingredients,image_url,category,available from public.pitacco_pizza_flavor_library where store_id=p_source
 on conflict do nothing;
 update public.public_menu_settings d set category_icons=s.category_icons from public.public_menu_settings s where s.store_id=p_source and d.store_id=dest;
 delete from public.pitacco_menu_category_order where store_id=dest;
 insert into public.pitacco_menu_category_order(store_id,category,sort_order)
 select dest,category,sort_order from public.pitacco_menu_category_order where store_id=p_source;
 select published into design from public.pitacco_storefront_designs where store_id=p_source;
 select coalesce(published,draft) into target_design from public.pitacco_storefront_designs where store_id=dest;
 if design is not null then
  -- A marca do destino prevalece, inclusive cores já personalizadas e slogan.
  design:=design||jsonb_build_object('logo_path',coalesce((select logo_path from public.stores where id=dest),''),'instagram',coalesce(target_design->>'instagram',''),'slogan',coalesce(target_design->>'slogan','Cardápio digital'));
  if target_design is not null then
   for item in select jsonb_build_object(key,value) from jsonb_each(target_design) where key in ('primary','secondary','background','paper','foreground','hero','highlight') loop design:=design||item;end loop;
  end if;
  if coalesce(design->>'cover_path','')<>'' then
   design:=jsonb_set(design,'{cover_path}',to_jsonb(pitacco_private.owner_copy_media_path(dest,p_request,design->>'cover_path')));
  end if;
  banners:='[]';
  for item in select value from jsonb_array_elements(design->'banners') loop
   if coalesce(item->>'image_path','')<>'' then item:=jsonb_set(item,'{image_path}',to_jsonb(pitacco_private.owner_copy_media_path(dest,p_request,item->>'image_path')));end if;
   if coalesce(item->>'product_id','')<>'' then
    if not ids ? (item->>'product_id') then raise exception 'Banner de origem contém produto ausente';end if;
    item:=jsonb_set(item,'{product_id}',ids->(item->>'product_id'));
   end if;
   banners:=banners||jsonb_build_array(item);
  end loop;
  design:=jsonb_set(design,'{banners}',banners);
  perform pitacco_private.validate_storefront_design(dest,design);
  for media in select path from (select design->>'cover_path' as path union select value->>'image_path' from jsonb_array_elements(banners)) paths where coalesce(path,'')<>'' loop
   if not exists(select 1 from storage.objects where bucket_id='pitacco-media' and name=media.path) then raise exception 'Arquivo visual ainda não copiado';end if;
  end loop;
  insert into public.pitacco_storefront_designs(store_id,draft,published,draft_version,published_version,published_at)
  values(dest,design,design,1,1,now()) on conflict(store_id) do update set draft=excluded.draft,published=excluded.published,draft_version=pitacco_storefront_designs.draft_version+1,published_version=pitacco_storefront_designs.published_version+1,published_at=now(),updated_at=now() returning published_version into revision;
  insert into public.pitacco_storefront_design_versions(store_id,version,snapshot,published_by) values(dest,revision,design,auth.uid());
 end if;
 result:=jsonb_build_object('store_id',dest,'created_store',p_target is null,'products',product_count,'groups',group_count,'options',option_count,'pizzas',pizza_count,'combos',combo_count,'hidden',false);
 insert into pitacco_private.owner_catalog_copy_requests values(p_request,auth.uid(),p_source,dest,result);
 insert into public.operation_audit(store_id,actor,action,details) values(dest,auth.uid(),case when p_target is null then 'owner_store_duplicated' else 'owner_catalog_cloned' end,result||jsonb_build_object('source_store_id',p_source));
 return result;
end $$;
revoke all on function public.pitacco_owner_copy_catalog(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_copy_catalog(uuid,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
