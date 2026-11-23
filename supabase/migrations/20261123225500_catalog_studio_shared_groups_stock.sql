-- Catálogo: biblioteca compartilhada de grupos de complementos, fotos e estoque de produtos acabados.
-- Nenhum produto existente é excluído; grupos ligados preservam seus IDs para pedidos anteriores.
alter table public.product_options add column if not exists image_url text not null default '';
alter table public.product_option_groups add column if not exists library_template_id uuid;
alter table public.product_option_groups add column if not exists enabled boolean not null default true;

create table if not exists public.pitacco_complement_templates(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 name text not null check(length(btrim(name)) between 2 and 100),
 min_select integer not null default 0 check(min_select>=0),
 max_select integer not null default 1 check(max_select between 1 and 100),
 options jsonb not null default '[]'::jsonb check(jsonb_typeof(options)='array'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint pitacco_templates_bounds check(min_select<=max_select),
 unique(id,store_id)
);
create index if not exists pitacco_templates_by_store on public.pitacco_complement_templates(store_id,name);
alter table public.product_option_groups
 drop constraint if exists option_groups_library_template_fk;
alter table public.product_option_groups
 add constraint option_groups_library_template_fk
 foreign key(library_template_id) references public.pitacco_complement_templates(id);
alter table public.product_options add column if not exists library_option_id uuid;

alter table public.pitacco_complement_templates enable row level security;
drop policy if exists pitacco_complement_template_select on public.pitacco_complement_templates;
create policy pitacco_complement_template_select on public.pitacco_complement_templates
 for select to authenticated using (pitacco_private.can_edit_catalog(store_id));
revoke all on public.pitacco_complement_templates from public,anon,authenticated;
grant select on public.pitacco_complement_templates to authenticated;

-- Opções dos complementos são visualizadas no cardápio público via get_public_menu.
-- O upload da foto usa a pasta "products/<loja>" já protegida no Storage.
create or replace function public.pitacco_set_option_photo(p_store uuid,p_option uuid,p_url text)
 returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store) then raise exception 'Sem autorização para editar complementos';end if;
 if length(coalesce(p_url,''))>2048 or (coalesce(p_url,'')<>'' and p_url !~ '^https://[^[:space:]]+$') then
  raise exception 'URL de imagem inválida';
 end if;
 update public.product_options set image_url=coalesce(p_url,'')
 where store_id=p_store and id=p_option;
 if not found then raise exception 'Complemento não encontrado nesta loja'; end if;
 return true;
end;
$$;
revoke all on function public.pitacco_set_option_photo(uuid,uuid,text) from public,anon;
grant execute on function public.pitacco_set_option_photo(uuid,uuid,text) to authenticated;

-- Salva grupo central sem precisar cadastrar produto primeiro e sincroniza
-- as cópias atribuídas. Nunca apaga grupo/opção usados no histórico.
create or replace function public.pitacco_complement_template_save(
 p_store uuid,p_template uuid,p_name text,p_min integer,p_max integer,
 p_options jsonb,p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_id uuid; v_source jsonb:='[]'::jsonb; v_opt jsonb; v_idopt uuid;
 v_products uuid[]:=coalesce(p_product_ids,array[]::uuid[]);
 v_product uuid; v_group uuid; v_row uuid;
 v_active integer:=0; v_count integer:=0;
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
  for v_opt in select value from jsonb_array_elements(v_source) loop
    select id into v_row from public.product_options
     where group_id=v_group and library_option_id=(v_opt->>'id')::uuid limit 1 for update;
    if v_row is null then
      insert into public.product_options(store_id,group_id,name,additional_price,available,image_url,library_option_id)
      values(p_store,v_group,v_opt->>'name',(v_opt->>'price')::numeric,(v_opt->>'available')::boolean,
       v_opt->>'image_url',(v_opt->>'id')::uuid);
    else
      update public.product_options set name=v_opt->>'name',additional_price=(v_opt->>'price')::numeric,
       available=(v_opt->>'available')::boolean,image_url=v_opt->>'image_url'
      where id=v_row and store_id=p_store;
    end if;
   end loop;
   v_group:=null;
   v_count:=v_count+1;
 end loop;
 return jsonb_build_object('id',v_id,'saved',true,'assigned_products',v_count,'options',v_source);
end;
$$;
revoke all on function public.pitacco_complement_template_save(uuid,uuid,text,integer,integer,jsonb,uuid[]) from public,anon;
grant execute on function public.pitacco_complement_template_save(uuid,uuid,text,integer,integer,jsonb,uuid[]) to authenticated;

-- Produto acabado: acompanhamento opcional, separado de ingredientes.
create table if not exists public.pitacco_finished_product_stock(
 store_id uuid not null references public.stores(id),
 product_id uuid not null references public.products(id),
 enabled boolean not null default false,
 balance numeric not null default 0 check(balance>=0),
 minimum numeric not null default 0 check(minimum>=0),
 updated_at timestamptz not null default now(),
 primary key(store_id,product_id)
);
alter table public.pitacco_finished_product_stock enable row level security;
drop policy if exists finished_stock_read on public.pitacco_finished_product_stock;
create policy finished_stock_read on public.pitacco_finished_product_stock for select to authenticated
 using(public.can_access_store(store_id));
drop policy if exists finished_stock_insert on public.pitacco_finished_product_stock;
create policy finished_stock_insert on public.pitacco_finished_product_stock for insert to authenticated
 with check(public.is_store_manager(store_id) and exists(select 1 from public.products p where p.id=product_id and p.store_id=store_id));
drop policy if exists finished_stock_update on public.pitacco_finished_product_stock;
create policy finished_stock_update on public.pitacco_finished_product_stock for update to authenticated
 using(public.is_store_manager(store_id))
 with check(public.is_store_manager(store_id) and exists(select 1 from public.products p where p.id=product_id and p.store_id=store_id));
revoke all on public.pitacco_finished_product_stock from public,anon,authenticated;
grant select,insert,update on public.pitacco_finished_product_stock to authenticated;

-- Estende os RPCs e o cardápio sem modificar dados ou contrato de checkout.
do $$
declare v_sql text; v_new text;
begin
 v_sql:=pg_get_functiondef('public.pitacco_list_complements(uuid,uuid)'::regprocedure);
 v_new:=replace(v_sql,'''price'',o.additional_price,''available''',
   '''price'',o.additional_price,''image_url'',o.image_url,''available''');
 if v_sql=v_new then raise exception 'Contrato dos complementos alterado: revisar migration';end if;
 execute v_new;
 v_sql:=pg_get_functiondef('public.get_public_menu(text)'::regprocedure);
 v_new:=replace(v_sql,'''price'',o.additional_price)',
   '''price'',o.additional_price,''image_url'',o.image_url)');
 if v_sql=v_new then raise exception 'Contrato público do cardápio alterado: revisar migration';end if;
 v_new:=replace(v_new,'where g.product_id=p.id)', 'where g.product_id=p.id and g.enabled)');
 if v_new not like '%g.enabled%' then raise exception 'Não foi possível aplicar filtro aos grupos';end if;
 execute v_new;
end;
$$;
