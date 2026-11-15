-- Match the existing catalog policy for store members and allow the verified proprietor.
create function pitacco_private.can_edit_catalog(p_store uuid)
returns boolean language sql stable set search_path='' as $function$
 select public.is_admin() or exists (
  select 1 from public.store_members where store_id=p_store and user_id=(select auth.uid())
    and role in ('lojista','gestor')
 )
$function$;
revoke all on function pitacco_private.can_edit_catalog(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.pitacco_list_complements(p_store_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'min',g.min_select,'max',g.max_select,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'price',o.additional_price,'available',o.available) order by o.sort_order,o.name) from public.product_options o where o.group_id=g.id),'[]'::jsonb)) order by g.sort_order,g.name),'[]'::jsonb)
from public.product_option_groups g where g.store_id=p_store_id and g.product_id=p_product_id and pitacco_private.can_edit_catalog(p_store_id)
$function$;

CREATE OR REPLACE FUNCTION public.pitacco_list_products(p_store_id uuid)
 RETURNS TABLE(id uuid, name text, category text, description text, price numeric, cost numeric, menu_active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select p.id,p.name,p.category,p.description,p.price,p.cost,p.menu_active from public.products p where p.store_id=p_store_id and pitacco_private.can_edit_catalog(p_store_id) order by p.category,p.name
$function$;

CREATE OR REPLACE FUNCTION public.pitacco_save_option(p_store_id uuid, p_group_id uuid, p_option_id uuid, p_name text, p_price numeric, p_available boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;begin
if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store_id) then raise exception 'Sem permissão';end if;
if not exists(select 1 from public.product_option_groups g where g.id=p_group_id and g.store_id=p_store_id) then raise exception 'Grupo não encontrado';end if;
if length(btrim(coalesce(p_name,''))) not between 1 and 100 or p_price is null or p_price<0 or p_price>100000 then raise exception 'Opção inválida';end if;
if p_option_id is null then
insert into public.product_options(store_id,group_id,name,additional_price,available) values(p_store_id,p_group_id,btrim(p_name),p_price,coalesce(p_available,true)) returning id into v_id;
else
update public.product_options set name=btrim(p_name),additional_price=p_price,available=coalesce(p_available,true) where id=p_option_id and store_id=p_store_id and group_id=p_group_id returning id into v_id;
if v_id is null then raise exception 'Opção não encontrada';end if;
end if;
if public.is_admin() then
 insert into public.operation_audit(store_id,actor,action,details)
  values(p_store_id,auth.uid(),'owner_catalog_option_saved',jsonb_build_object('option_id',v_id));
end if;
return v_id;end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_save_option_group(p_store_id uuid, p_product_id uuid, p_group_id uuid, p_name text, p_min integer, p_max integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;begin
if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store_id) then raise exception 'Sem permissão';end if;
if not exists(select 1 from public.products p where p.id=p_product_id and p.store_id=p_store_id) then raise exception 'Produto não encontrado';end if;
if length(btrim(coalesce(p_name,''))) not between 2 and 100 or p_min is null or p_max is null or p_min<0 or p_max<1 or p_max>100 or p_min>p_max then raise exception 'Grupo ou limites inválidos';end if;
if p_group_id is null then
insert into public.product_option_groups(store_id,product_id,name,min_select,max_select) values(p_store_id,p_product_id,btrim(p_name),p_min,p_max) returning id into v_id;
else
update public.product_option_groups set name=btrim(p_name),min_select=p_min,max_select=p_max where id=p_group_id and store_id=p_store_id and product_id=p_product_id returning id into v_id;
if v_id is null then raise exception 'Grupo não encontrado';end if;
end if;
if public.is_admin() then
 insert into public.operation_audit(store_id,actor,action,details)
  values(p_store_id,auth.uid(),'owner_catalog_group_saved',jsonb_build_object('group_id',v_id));
end if;
return v_id;end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_save_product(p_store_id uuid, p_product_id uuid, p_name text, p_category text, p_description text, p_price numeric, p_cost numeric, p_menu_active boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;begin
if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store_id) then raise exception 'Sem permissão para alterar produtos';end if;
if length(btrim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Nome do produto inválido';end if;
if length(coalesce(p_category,''))>80 or length(coalesce(p_description,''))>1000 then raise exception 'Categoria ou descrição muito longa';end if;
if p_price is null or p_price<0 or p_price>100000 or p_cost is null or p_cost<0 or p_cost>100000 then raise exception 'Preço ou custo inválido';end if;
if p_product_id is null then
insert into public.products(store_id,name,category,description,price,cost,menu_active) values(p_store_id,btrim(p_name),btrim(coalesce(p_category,'')),btrim(coalesce(p_description,'')),p_price,p_cost,coalesce(p_menu_active,false)) returning id into v_id;
else
update public.products set name=btrim(p_name),category=btrim(coalesce(p_category,'')),description=btrim(coalesce(p_description,'')),price=p_price,cost=p_cost,menu_active=coalesce(p_menu_active,false) where id=p_product_id and store_id=p_store_id returning id into v_id;
if v_id is null then raise exception 'Produto não encontrado nesta loja';end if;
end if;
if public.is_admin() then
 insert into public.operation_audit(store_id,actor,action,details)
  values(p_store_id,auth.uid(),'owner_catalog_product_saved',jsonb_build_object('product_id',v_id));
end if;
return v_id;end $function$;

revoke all on function public.pitacco_list_products(uuid),
  public.pitacco_save_product(uuid,uuid,text,text,text,numeric,numeric,boolean),
  public.pitacco_list_complements(uuid,uuid),public.pitacco_save_option(uuid,uuid,uuid,text,numeric,boolean),
  public.pitacco_save_option_group(uuid,uuid,uuid,text,integer,integer) from public,anon;
grant execute on function public.pitacco_list_products(uuid),
  public.pitacco_save_product(uuid,uuid,text,text,text,numeric,numeric,boolean),
  public.pitacco_list_complements(uuid,uuid),public.pitacco_save_option(uuid,uuid,uuid,text,numeric,boolean),
  public.pitacco_save_option_group(uuid,uuid,uuid,text,integer,integer) to authenticated;

create function public.pitacco_owner_menu_settings(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Acesso exclusivo do proprietário do Pitacco';end if;
 select to_jsonb(menu) into result from public.public_menu_settings menu where store_id=p_store;
 return result;
end;
$function$;
revoke all on function public.pitacco_owner_menu_settings(uuid) from public,anon;
grant execute on function public.pitacco_owner_menu_settings(uuid) to authenticated;
