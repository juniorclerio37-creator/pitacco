-- Importador de cardapios: cada loja só pode importar no próprio catálogo.
-- A substituição oculta itens anteriores (preserva pedidos, fichas técnicas e histórico).
create table if not exists public.pitacco_menu_import_history (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 actor uuid not null,
 mode text not null check (mode in ('add','replace')),
 origin text not null default '',
 created_at timestamptz not null default now(),
 before_products jsonb not null default '[]'::jsonb,
 summary jsonb not null default '{}'::jsonb
);
create index if not exists pitacco_menu_import_history_store_time
 on public.pitacco_menu_import_history(store_id,created_at desc);
alter table public.pitacco_menu_import_history enable row level security;
revoke all on public.pitacco_menu_import_history from public,anon,authenticated;

create or replace function public.pitacco_menu_import_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null
    and p_store is not null
    and pitacco_private.can_edit_catalog(p_store)
$$;
revoke all on function public.pitacco_menu_import_allowed(uuid) from public,anon;
grant execute on function public.pitacco_menu_import_allowed(uuid) to authenticated;
drop policy if exists "manager_reads_menu_import_history" on public.pitacco_menu_import_history;
create policy "manager_reads_menu_import_history"
 on public.pitacco_menu_import_history for select to authenticated
 using (public.pitacco_menu_import_allowed(store_id));
grant select on public.pitacco_menu_import_history to authenticated;

create or replace function public.pitacco_menu_import_apply(
 p_store uuid, p_items jsonb, p_mode text default 'add', p_origin text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
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
       coalesce((v_item->>'active')::boolean,true),nullif(v_item->>'image_url',''),false)
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
$$;
revoke all on function public.pitacco_menu_import_apply(uuid,jsonb,text,text) from public,anon;
grant execute on function public.pitacco_menu_import_apply(uuid,jsonb,text,text) to authenticated;
