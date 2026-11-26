-- Link identical imported groups without rewriting any catalog option or group identity.
create or replace function pitacco_private.centralize_unlinked_import_groups(p_store uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare g record; t_id uuid; sig jsonb; options_json jsonb; n int:=0; mapped int; expected int;
begin
 if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,4141));
 for g in select og.id,og.product_id,og.name,og.min_select,og.max_select from public.product_option_groups og join public.products p on p.id=og.product_id and p.store_id=og.store_id where og.store_id=p_store and og.library_template_id is null and og.enabled is not false and p.menu_active
  and not exists(select 1 from public.product_options o where o.store_id=p_store and o.group_id=og.id and o.library_option_id is not null)
  order by og.product_id,og.sort_order,og.id for update of og
 loop
  select jsonb_agg(jsonb_build_array(o.name,o.additional_price,o.available,coalesce(o.image_url,'')) order by o.sort_order,o.name,o.additional_price,o.available,coalesce(o.image_url,''),o.id),
   jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'price',o.additional_price,'available',o.available,'image_url',coalesce(o.image_url,'')) order by o.sort_order,o.name,o.additional_price,o.available,coalesce(o.image_url,''),o.id),count(*)
  into sig,options_json,expected from public.product_options o where o.store_id=p_store and o.group_id=g.id;
  if expected=0 or expected>100 then continue;end if;
  select t.id into t_id from public.pitacco_complement_templates t
  where t.store_id=p_store and t.name=g.name and t.min_select=g.min_select and t.max_select=g.max_select
   and not exists(select 1 from public.product_option_groups og where og.store_id=p_store and og.product_id=g.product_id and og.library_template_id=t.id)
   and (select jsonb_agg(jsonb_build_array(x.value->>'name',(x.value->>'price')::numeric,coalesce((x.value->>'available')::boolean,true),coalesce(x.value->>'image_url','')) order by x.ordinality) from jsonb_array_elements(t.options) with ordinality x)=sig
  order by t.sort_order,t.id limit 1;
  if t_id is null then
   insert into public.pitacco_complement_templates(store_id,name,min_select,max_select,options,sort_order)
   values(p_store,g.name,g.min_select,g.max_select,options_json,coalesce((select max(sort_order) from public.pitacco_complement_templates where store_id=p_store),0)+10) returning id into t_id;
  end if;
  with ranked as (
   select o.id,row_number() over(order by o.sort_order,o.name,o.additional_price,o.available,coalesce(o.image_url,''),o.id) pos
   from public.product_options o where o.store_id=p_store and o.group_id=g.id
  ), canonical as (
   select (x.value->>'id')::uuid id,x.ordinality pos from public.pitacco_complement_templates t cross join lateral jsonb_array_elements(t.options) with ordinality x where t.store_id=p_store and t.id=t_id
  )
  update public.product_options o set library_option_id=c.id from ranked r join canonical c using(pos) where o.id=r.id and o.store_id=p_store;
  get diagnostics mapped=row_count;
  if mapped<>expected then raise exception 'Vínculos de complementos incompletos';end if;
  update public.product_option_groups set library_template_id=t_id where id=g.id and store_id=p_store and library_template_id is null;
  n:=n+1;t_id:=null;
 end loop;
 return n;
end $$;
revoke all on function pitacco_private.centralize_unlinked_import_groups(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.pitacco_menu_import_apply(p_store uuid, p_items jsonb, p_mode text DEFAULT 'add'::text, p_origin text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_item jsonb; v_group jsonb; v_option jsonb;
 v_product uuid; v_group_id uuid;
 v_total int; v_group_total int:=0; v_option_total int:=0;
 v_added int:=0; v_skipped int:=0; v_archived int:=0;
 v_old jsonb; v_history uuid;
 v_name text; v_cat text; v_desc text; v_image text; v_group_name text; v_option_name text;
 v_price numeric; v_extra numeric; v_min int; v_max int;
 v_available int; v_n int;
begin
 if (select auth.uid()) is null or not pitacco_private.can_edit_catalog(p_store) then
   raise exception 'Você não tem permissão para importar produtos nesta loja';
 end if;
 if p_mode not in ('add','replace') then raise exception 'Modo de importação inválido'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Lista de produtos inválida'; end if;
 v_total:=jsonb_array_length(p_items);
 if v_total<1 or v_total>300 then raise exception 'A importação deve ter entre 1 e 300 produtos'; end if;
 if length(coalesce(p_origin,''))>300 then raise exception 'Origem inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,72314));
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,4141));
 if (select count(*) from public.products where store_id=p_store and menu_active)>400 then
   raise exception 'Esta loja ultrapassou o limite de segurança para importação em lote';
 end if;

 -- Primeiro validar TODO o conteúdo. Qualquer falha reverte a operação inteira.
 for v_item in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(v_item) <> 'object' then raise exception 'Produto inválido'; end if;
   v_name:=btrim(coalesce(v_item->>'name',''));
   v_cat:=btrim(coalesce(v_item->>'category','Outros'));
   v_desc:=coalesce(v_item->>'description','');
   v_image:=coalesce(v_item->>'image_url','');
   if length(v_name) not between 2 and 120 or length(v_cat)>80 or length(v_desc)>1000 then
     raise exception 'Nome, categoria ou descrição inválidos: %',left(v_name,70);
   end if;
   if jsonb_typeof(v_item->'price') not in ('number','string') then
     raise exception 'Preço não informado para %',v_name;
   end if;
   begin v_price:=(v_item->>'price')::numeric;exception when others then raise exception 'Preço inválido para %',v_name;end;
   if v_price<=0 or v_price>100000 or v_price<>round(v_price,2) then
     raise exception 'Preço inválido para %',v_name;
   end if;
   if length(v_image)>2048 or (v_image<>'' and v_image !~ '^https://[^[:space:]]+$') then
     raise exception 'Foto inválida para %',v_name;
   end if;
   if jsonb_typeof(v_item->'groups') not in ('array',null) and v_item ? 'groups' then
     raise exception 'Grupos de % precisam ser uma lista',v_name;
   end if;
   if jsonb_array_length(coalesce(v_item->'groups','[]'::jsonb))>40 then
     raise exception 'Excesso de grupos em %',v_name;
   end if;
   for v_group in select value from jsonb_array_elements(coalesce(v_item->'groups','[]'::jsonb)) loop
     v_group_name:=btrim(coalesce(v_group->>'name',''));
     begin
       v_min:=(v_group->>'min')::int;
       v_max:=(v_group->>'max')::int;
     exception when others then raise exception 'Limites inválidos no grupo %',v_group_name;end;
     if length(v_group_name) not between 2 and 100 or v_min<0 or v_max<1 or v_max>100 or v_min>v_max then
       raise exception 'Grupo ou limites inválidos: %',v_group_name;
     end if;
     if jsonb_typeof(v_group->'options')<>'array' then
       raise exception 'Opções ausentes no grupo %',v_group_name;
     end if;
     v_n:=jsonb_array_length(v_group->'options');
     if v_n<1 or v_n>100 then raise exception 'Número de opções inválido em %',v_group_name;end if;
     v_available:=0;
     for v_option in select value from jsonb_array_elements(v_group->'options') loop
       v_option_name:=btrim(coalesce(v_option->>'name',''));
       begin v_extra:=(v_option->>'price')::numeric;
       exception when others then raise exception 'Preço adicional inválido em %',v_group_name;end;
       if length(v_option_name) not between 1 and 100 or v_extra<0 or v_extra>100000 or v_extra<>round(v_extra,2) then
         raise exception 'Opção inválida em %',v_group_name;
       end if;
       if coalesce((v_option->>'available')::boolean,true) then v_available:=v_available+1;end if;
       v_option_total:=v_option_total+1;
     end loop;
     if v_available<v_min then raise exception 'Escolhas obrigatórias indisponíveis em %',v_group_name;end if;
     v_group_total:=v_group_total+1;
   end loop;
 end loop;
 if v_option_total>12000 then raise exception 'Excesso de complementos na importação';end if;
 -- Histórico restaura a estrutura lógica anterior; nenhum item/pedido é excluído.
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'category',p.category,'description',p.description,
   'price',p.price,'cost',p.cost,'image_url',p.image_url,'menu_active',p.menu_active,
   'groups',coalesce((select jsonb_agg(jsonb_build_object(
       'id',g.id,'name',g.name,'min',g.min_select,'max',g.max_select,
       'options',coalesce((select jsonb_agg(jsonb_build_object(
          'id',o.id,'name',o.name,'price',o.additional_price,'available',o.available)
          order by o.sort_order) from public.product_options o where o.group_id=g.id),'[]'::jsonb))
     order by g.sort_order) from public.product_option_groups g where g.product_id=p.id),'[]'::jsonb)
 ) order by p.id),'[]'::jsonb)
 into v_old from public.products p where p.store_id=p_store and p.menu_active;
 insert into public.pitacco_menu_import_history(store_id,actor,mode,origin,before_products)
 values(p_store,auth.uid(),p_mode,coalesce(p_origin,''),v_old) returning id into v_history;
 if p_mode='replace' then
   update public.products set menu_active=false where store_id=p_store and menu_active;
   get diagnostics v_archived=row_count;
 end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_name:=btrim(v_item->>'name');
   v_cat:=btrim(coalesce(v_item->>'category','Outros'));
   if p_mode='add' and exists (
      select 1 from public.products p where p.store_id=p_store and p.menu_active
      and lower(btrim(p.name))=lower(v_name) and lower(btrim(p.category))=lower(v_cat)
   ) then
      v_skipped:=v_skipped+1;continue;
   end if;
   insert into public.products(store_id,name,category,description,price,cost,menu_active,image_url,
      sealed_industrial_beverage)
    values(p_store,v_name,v_cat,coalesce(v_item->>'description',''),(v_item->>'price')::numeric,0,
       coalesce((v_item->>'active')::boolean,true),coalesce(v_item->>'image_url',''),false)
    returning id into v_product;
   v_added:=v_added+1;
   for v_group in select value from jsonb_array_elements(coalesce(v_item->'groups','[]'::jsonb)) loop
      insert into public.product_option_groups(store_id,product_id,name,min_select,max_select,sort_order)
       values(p_store,v_product,btrim(v_group->>'name'),(v_group->>'min')::int,(v_group->>'max')::int,
           coalesce((v_group->>'sort_order')::int,0))
       returning id into v_group_id;
      for v_option in select value from jsonb_array_elements(v_group->'options') loop
         insert into public.product_options(store_id,group_id,name,additional_price,available,sort_order)
         values(p_store,v_group_id,btrim(v_option->>'name'),(v_option->>'price')::numeric,
           coalesce((v_option->>'available')::boolean,true),
           coalesce((v_option->>'sort_order')::int,0));
      end loop;
   end loop;
 end loop;
 perform pitacco_private.centralize_unlinked_import_groups(p_store);
 update public.pitacco_menu_import_history
 set summary=jsonb_build_object('received',v_total,'created',v_added,'duplicates',v_skipped,
     'archived',v_archived,'groups',v_group_total,'options',v_option_total)
 where id=v_history;
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,auth.uid(),'menu_import_completed',
    jsonb_build_object('batch_id',v_history,'created',v_added,'archived',v_archived,'mode',p_mode));
 return jsonb_build_object('saved',true,'batch_id',v_history,
    'created',v_added,'duplicates',v_skipped,'archived',v_archived,
    'groups',v_group_total,'options',v_option_total);
end;
$function$;
