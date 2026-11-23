-- Sincronizar ordem da biblioteca nos produtos vinculados sem apagar grupos antigos.
CREATE OR REPLACE FUNCTION public.pitacco_catalog_reorder(p_store uuid, p_kind text, p_ids uuid[] DEFAULT NULL::uuid[], p_parent uuid DEFAULT NULL::uuid, p_category text DEFAULT NULL::text, p_categories text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   -- Todos os produtos vinculados passam a usar a mesma posição do grupo central.
   -- Grupos não vinculados e o histórico dos pedidos permanecem intactos.
   update public.product_option_groups
    set sort_order=v_rank
    where store_id=p_store and library_template_id=v_id and enabled;
  end if;
 end loop;
 return jsonb_build_object('saved',true,'kind',p_kind,'count',v_rank/10);
end;
$function$;
