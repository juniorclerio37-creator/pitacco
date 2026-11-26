-- Super Admin: cópia transacional de catálogo e criação de estabelecimento independente.
create table pitacco_private.owner_catalog_copy_requests(
 request_id uuid primary key, actor uuid not null, source_id uuid not null,
 target_id uuid not null, result jsonb not null
);
alter table pitacco_private.owner_catalog_copy_requests enable row level security;
revoke all on pitacco_private.owner_catalog_copy_requests from public,anon,authenticated;
create function public.pitacco_owner_copy_catalog(p_source uuid,p_target uuid,p_new_name text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare dest uuid:=p_target; pr record; gr record; opt record; pizza record; draft record; new_product uuid; new_group uuid; new_draft uuid; product_count int:=0; group_count int:=0; option_count int:=0; pizza_count int:=0; old_result record; result jsonb; source_name text; 
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
 if dest is null then
  insert into public.stores(name,platform,plan,description)
   select btrim(p_new_name),'delivery proprio','saas',description from public.stores where id=p_source returning id into dest;
  update public.public_menu_settings set enabled=false where store_id=dest;
 elsif not exists(select 1 from public.stores where id=dest) then raise exception 'Loja de destino não encontrada';end if;
 -- Não substitui catálogo existente. Colisões de nome/categoria abortam toda a operação.
 if exists(select 1 from public.products a join public.products b on lower(btrim(a.name))=lower(btrim(b.name)) and lower(btrim(a.category))=lower(btrim(b.category)) where a.store_id=p_source and b.store_id=dest) then
  raise exception 'Já existem produtos com o mesmo nome e categoria no destino. Nenhum item foi copiado';
 end if;
 for pr in select * from public.products where store_id=p_source order by sort_order,id loop
  insert into public.products(store_id,name,category,description,price,cost,menu_active,image_url,sealed_industrial_beverage,sort_order)
   values(dest,pr.name,pr.category,pr.description,pr.price,0,false,pr.image_url,pr.sealed_industrial_beverage,pr.sort_order) returning id into new_product;
  product_count:=product_count+1;
  for gr in select * from public.product_option_groups where store_id=p_source and product_id=pr.id order by sort_order,id loop
   insert into public.product_option_groups(store_id,product_id,name,min_select,max_select,sort_order,enabled)
    values(dest,new_product,gr.name,gr.min_select,gr.max_select,gr.sort_order,gr.enabled) returning id into new_group;
   group_count:=group_count+1;
   for opt in select * from public.product_options where store_id=p_source and group_id=gr.id order by sort_order,id loop
    insert into public.product_options(store_id,group_id,name,additional_price,available,sort_order,image_url)
     values(dest,new_group,opt.name,opt.additional_price,opt.available,opt.sort_order,opt.image_url);
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
 -- Ícones e ordem das categorias: mantém escolhas já feitas no destino.
 update public.public_menu_settings d set category_icons=coalesce(s.category_icons,'{}'::jsonb)||coalesce(d.category_icons,'{}'::jsonb)
 from public.public_menu_settings s where s.store_id=p_source and d.store_id=dest;
 insert into public.pitacco_menu_category_order(store_id,category,sort_order)
 select dest,category,sort_order from public.pitacco_menu_category_order where store_id=p_source
 on conflict(store_id,category) do nothing;
 result:=jsonb_build_object('store_id',dest,'created_store',p_target is null,'products',product_count,'groups',group_count,'options',option_count,'pizzas',pizza_count,'hidden',true);
 insert into pitacco_private.owner_catalog_copy_requests values(p_request,auth.uid(),p_source,dest,result);
 insert into public.operation_audit(store_id,actor,action,details) values(dest,auth.uid(),case when p_target is null then 'owner_store_duplicated' else 'owner_catalog_cloned' end,result||jsonb_build_object('source_store_id',p_source));
 return result;
end $$;
revoke all on function public.pitacco_owner_copy_catalog(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_copy_catalog(uuid,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
