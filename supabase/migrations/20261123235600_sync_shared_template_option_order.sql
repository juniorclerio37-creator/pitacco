-- Preserva a ordem dos complementos ao aplicar grupos compartilhados aos produtos.
CREATE OR REPLACE FUNCTION public.pitacco_complement_template_save(p_store uuid, p_template uuid, p_name text, p_min integer, p_max integer, p_options jsonb, p_product_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_id uuid; v_source jsonb:='[]'::jsonb; v_opt jsonb; v_idopt uuid;
 v_products uuid[]:=coalesce(p_product_ids,array[]::uuid[]);
 v_product uuid; v_group uuid; v_row uuid;
 v_active integer:=0; v_count integer:=0; v_option_sort integer:=0;
begin
 if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store) then raise exception 'Sem autorização nesta loja';end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 100 or p_min is null or p_max is null
 or p_min<0 or p_max<1 or p_max>100 or p_min>p_max then raise exception 'Grupo ou limites inválidos';end if;
 if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options)>100 then
  raise exception 'Lista de complementos inválida';end if;
 if cardinality(v_products)>200 or cardinality(v_products)<>(select count(distinct x) from unnest(v_products) x) then
  raise exception 'Seleção de produtos inválida';end if;
 if (select count(*) from public.products where store_id=p_store and id=any(v_products))<>cardinality(v_products) then
  raise exception 'Produto não pertence à loja';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,4141));
 if p_template is not null then
  perform 1 from public.pitacco_complement_templates where id=p_template and store_id=p_store for update;
  if not found then raise exception 'Grupo central não encontrado';end if;
 end if;
 for v_opt in select value from jsonb_array_elements(p_options) loop
  if jsonb_typeof(v_opt) <> 'object' then raise exception 'Opção inválida';end if;
  if length(btrim(coalesce(v_opt->>'name',''))) not between 1 and 100
  or (v_opt->>'price') is null then raise exception 'Informe o nome e o preço de cada complemento';end if;
  if (v_opt->>'price')::numeric<0 or (v_opt->>'price')::numeric>100000
   or (v_opt->>'price')::numeric<>round((v_opt->>'price')::numeric,2) then
   raise exception 'Preço adicional inválido';end if;
  if length(coalesce(v_opt->>'image_url',''))>2048
  or (coalesce(v_opt->>'image_url','')<>'' and (v_opt->>'image_url') !~ '^https://[^[:space:]]+$') then
   raise exception 'Foto inválida';end if;
  v_idopt:=coalesce(nullif(v_opt->>'id','')::uuid,gen_random_uuid());
  if exists(select 1 from jsonb_array_elements(v_source) x where x->>'id'=v_idopt::text) then
   raise exception 'Opções duplicadas';end if;
  v_source:=v_source||jsonb_build_array(jsonb_build_object('id',v_idopt,'name',btrim(v_opt->>'name'),
    'price',(v_opt->>'price')::numeric,'available',coalesce((v_opt->>'available')::boolean,true),
    'image_url',coalesce(v_opt->>'image_url','')));
  if coalesce((v_opt->>'available')::boolean,true) then v_active:=v_active+1;end if;
 end loop;
 if cardinality(v_products)>0 and v_active<p_min then raise exception 'Complementos disponíveis abaixo do mínimo';end if;
 if p_template is null then
  insert into public.pitacco_complement_templates(store_id,name,min_select,max_select,options)
  values(p_store,btrim(p_name),p_min,p_max,v_source) returning id into v_id;
 else
  update public.pitacco_complement_templates set name=btrim(p_name),min_select=p_min,max_select=p_max,
    options=v_source,updated_at=now() where id=p_template and store_id=p_store returning id into v_id;
 end if;
 update public.product_option_groups set enabled=false
 where store_id=p_store and library_template_id=v_id
   and not(product_id=any(v_products));
 foreach v_product in array v_products loop
  select id into v_group from public.product_option_groups
   where store_id=p_store and product_id=v_product and library_template_id=v_id limit 1 for update;
  if v_group is null then
    insert into public.product_option_groups(store_id,product_id,name,min_select,max_select,library_template_id,enabled)
    values(p_store,v_product,btrim(p_name),p_min,p_max,v_id,true) returning id into v_group;
  else
    update public.product_option_groups set name=btrim(p_name),min_select=p_min,max_select=p_max,enabled=true
     where id=v_group;
  end if;
  update public.product_options set available=false where store_id=p_store and group_id=v_group
    and library_option_id is not null
    and not(library_option_id::text in (select x->>'id' from jsonb_array_elements(v_source) x));
  v_option_sort:=0;
  for v_opt in select value from jsonb_array_elements(v_source) loop
    v_option_sort:=v_option_sort+10;
    select id into v_row from public.product_options
     where group_id=v_group and library_option_id=(v_opt->>'id')::uuid limit 1 for update;
    if v_row is null then
      insert into public.product_options(store_id,group_id,name,additional_price,available,image_url,library_option_id,sort_order)
      values(p_store,v_group,v_opt->>'name',(v_opt->>'price')::numeric,(v_opt->>'available')::boolean,
       v_opt->>'image_url',(v_opt->>'id')::uuid,v_option_sort);
    else
      update public.product_options set name=v_opt->>'name',additional_price=(v_opt->>'price')::numeric,
       available=(v_opt->>'available')::boolean,image_url=v_opt->>'image_url',sort_order=v_option_sort
      where id=v_row and store_id=p_store;
    end if;
   end loop;
   v_group:=null;
   v_count:=v_count+1;
 end loop;
 return jsonb_build_object('id',v_id,'saved',true,'assigned_products',v_count,'options',v_source);
end;
$function$;
