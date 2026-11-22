-- Controle de perdas por cancelamento e devolução física de bebidas lacradas.
-- Cadastro do produto decide elegibilidade. Sem reverter alimentos preparados.
-- Sem mutação histórica e sem alterações ao Fideliza+.

alter table public.products
 add column sealed_industrial_beverage boolean not null default false;

-- Mantém a RPC original para clientes mais antigos.
create or replace function public.pitacco_save_product_with_beverage(
 p_store_id uuid,p_product_id uuid,p_name text,p_category text,
 p_description text,p_price numeric,p_cost numeric,p_menu_active boolean,
 p_sealed_beverage boolean)
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_id uuid;
begin
 if p_sealed_beverage is null then raise exception 'Informe se a bebida é lacrada'; end if;
 v_id:=public.pitacco_save_product(p_store_id,p_product_id,p_name,p_category,
   p_description,p_price,p_cost,p_menu_active);
 update public.products set sealed_industrial_beverage=p_sealed_beverage
 where id=v_id and store_id=p_store_id;
 if not found then raise exception 'Produto não encontrado';end if;
 return v_id;
end $function$;
revoke all on function public.pitacco_save_product_with_beverage(
 uuid,uuid,text,text,text,numeric,numeric,boolean,boolean) from public,anon;
grant execute on function public.pitacco_save_product_with_beverage(
 uuid,uuid,text,text,text,numeric,numeric,boolean,boolean) to authenticated;

create or replace function public.pitacco_list_products_with_beverage(p_store_id uuid)
returns table(id uuid,name text,category text,description text,price numeric,
 cost numeric,menu_active boolean,sealed_industrial_beverage boolean)
language sql stable security definer set search_path='' as $function$
 select p.id,p.name,p.category,p.description,p.price,p.cost,p.menu_active,
  p.sealed_industrial_beverage from public.products p
 where p.store_id=p_store_id and pitacco_private.can_edit_catalog(p_store_id)
 order by p.category,p.name
$function$;
revoke all on function public.pitacco_list_products_with_beverage(uuid)
 from public,anon;
grant execute on function public.pitacco_list_products_with_beverage(uuid)
 to authenticated;

-- Snapshot das unidades e ingredientes no aceite. Produtos já aceitos antes
-- da implantação não se tornam retornáveis retroativamente.
create table public.pitacco_cancel_beverage_units(
 order_id uuid not null references public.orders(id) on delete cascade,
 store_id uuid not null references public.stores(id),
 product_id uuid not null,
 product_name text not null,
 ordered_quantity integer not null check(ordered_quantity between 1 and 20),
 created_at timestamptz not null default now(),
 primary key(order_id,product_id),
 unique(order_id,product_id,store_id)
);
create index pitacco_cancel_beverage_units_store_idx
 on public.pitacco_cancel_beverage_units(store_id,order_id);
alter table public.pitacco_cancel_beverage_units enable row level security;
revoke all on public.pitacco_cancel_beverage_units from public,anon,authenticated;
grant select on public.pitacco_cancel_beverage_units to authenticated;
create policy pitacco_cancel_beverage_units_manager
 on public.pitacco_cancel_beverage_units for select to authenticated
 using(public.is_store_manager(store_id));

create table public.pitacco_cancel_beverage_recipe(
 order_id uuid not null,
 store_id uuid not null,
 product_id uuid not null,
 ingredient_id uuid not null,
 quantity_per_unit numeric(14,3) not null check(quantity_per_unit>0),
 unit_cost_at_accept numeric(18,6) check(unit_cost_at_accept>=0),
 primary key(order_id,product_id,ingredient_id),
 foreign key(order_id,product_id,store_id)
  references public.pitacco_cancel_beverage_units(order_id,product_id,store_id)
  on delete cascade,
 foreign key(store_id,ingredient_id)
  references public.pitacco_ingredients(store_id,id)
);
alter table public.pitacco_cancel_beverage_recipe enable row level security;
revoke all on public.pitacco_cancel_beverage_recipe from public,anon,authenticated;
grant select on public.pitacco_cancel_beverage_recipe to authenticated;
create policy pitacco_cancel_beverage_recipe_manager
 on public.pitacco_cancel_beverage_recipe for select to authenticated
 using(public.is_store_manager(store_id));

create table public.pitacco_cancel_beverage_returns(
 id uuid primary key,
 order_id uuid not null references public.orders(id),
 store_id uuid not null references public.stores(id),
 product_id uuid not null,
 returned_quantity integer not null check(returned_quantity between 1 and 20),
 recovered_known_cost numeric(18,2) not null default 0 check(recovered_known_cost>=0),
 missing_ingredient_prices integer not null default 0 check(missing_ingredient_prices>=0),
 actor uuid not null,
 received_at timestamptz not null default now(),
 foreign key(order_id,product_id,store_id)
  references public.pitacco_cancel_beverage_units(order_id,product_id,store_id)
);
create index pitacco_cancel_beverage_returns_store_idx
 on public.pitacco_cancel_beverage_returns(store_id,order_id,product_id);
alter table public.pitacco_cancel_beverage_returns enable row level security;
revoke all on public.pitacco_cancel_beverage_returns from public,anon,authenticated;
grant select on public.pitacco_cancel_beverage_returns to authenticated;
create policy pitacco_cancel_beverage_returns_manager
 on public.pitacco_cancel_beverage_returns for select to authenticated
 using(public.is_store_manager(store_id));

-- Estornos físicos são movimentos NOVOS com ordem original preservada.
-- A baixa original mantém o seu UNIQUE(order_id,ingredient_id).
alter table public.pitacco_stock_movements
 add column cancellation_beverage_return_id uuid
 references public.pitacco_cancel_beverage_returns(id);
create unique index pitacco_stock_beverage_return_no_duplicates
 on public.pitacco_stock_movements(cancellation_beverage_return_id,ingredient_id)
 where cancellation_beverage_return_id is not null;
alter table public.pitacco_stock_movements add constraint
 pitacco_stock_beverage_return_has_positive_no_order
 check(cancellation_beverage_return_id is null or
   (order_id is null and quantity>0));
drop policy pitacco_stock_manual on public.pitacco_stock_movements;
create policy pitacco_stock_manual on public.pitacco_stock_movements
 for insert to authenticated
 with check(public.is_store_manager(store_id) and order_id is null
  and cancellation_beverage_return_id is null and actor=(select auth.uid()));

-- Depois da baixa original no aceite, guardar as receitas das bebidas
-- elegíveis (sem complementos) e o custo unitário HISTÓRICO dos insumos.
create or replace function pitacco_private.pitacco_snapshot_sealed_beverages()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if new.source<>'proprio' or new.status<>'accepted' or old.status='accepted'
  or jsonb_typeof(new.receipt->'items') is distinct from 'array'
  or not exists(select 1 from public.pitacco_order_material_cost_summary s
    where s.order_id=new.id and s.store_id=new.store_id) then return new;end if;

 insert into public.pitacco_cancel_beverage_units
   (order_id,store_id,product_id,product_name,ordered_quantity)
 select new.id,new.store_id,p.id,p.name,(l.item->>'quantity')::integer
 from jsonb_array_elements(new.receipt->'items') l(item)
 join public.products p on p.id=case
   when l.item->>'product_id' ~
     '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
   then (l.item->>'product_id')::uuid end and p.store_id=new.store_id
 where p.sealed_industrial_beverage
   and l.item->>'quantity' ~ '^[0-9]{1,2}$'
   and (l.item->>'quantity')::integer between 1 and 20
   and jsonb_array_length(case when jsonb_typeof(l.item->'modifiers')='array'
        then l.item->'modifiers' else '[]'::jsonb end)=0
   and exists(select 1 from public.pitacco_recipe_lines r
       where r.store_id=new.store_id and r.product_id=p.id)
   and not exists(
       select 1 from public.pitacco_recipe_lines r
       where r.store_id=new.store_id and r.product_id=p.id
         and not exists(select 1 from public.pitacco_stock_movements m
           where m.store_id=new.store_id and m.order_id=new.id
            and m.ingredient_id=r.ingredient_id and m.quantity<0
            and -m.quantity>=r.quantity*(l.item->>'quantity')::integer))
 on conflict(order_id,product_id) do nothing;

 insert into public.pitacco_cancel_beverage_recipe
   (order_id,store_id,product_id,ingredient_id,quantity_per_unit,unit_cost_at_accept)
 select u.order_id,u.store_id,u.product_id,r.ingredient_id,r.quantity,c.unit_cost
 from public.pitacco_cancel_beverage_units u
 join public.pitacco_recipe_lines r
   on r.store_id=u.store_id and r.product_id=u.product_id
 left join public.pitacco_order_material_cost_lines c
   on c.order_id=u.order_id and c.store_id=u.store_id
    and c.ingredient_id=r.ingredient_id
 where u.order_id=new.id and u.store_id=new.store_id
 on conflict(order_id,product_id,ingredient_id) do nothing;
 return new;
end $function$;
revoke all on function pitacco_private.pitacco_snapshot_sealed_beverages()
 from public,anon,authenticated;
create trigger pitacco_snapshot_sealed_beverages_on_accept
 after update of status on public.orders
 for each row when(old.status is distinct from new.status)
 execute function pitacco_private.pitacco_snapshot_sealed_beverages();

-- Conferência física obrigatória. O cliente e entregador não podem chamar.
-- Concorrência é serializada por lock no pedido, e a chave p_request
-- garante que retries não somem quantidades novamente.
create or replace function public.pitacco_confirm_sealed_beverage_return(
 p_store uuid,p_order uuid,p_product uuid,p_quantity integer,p_request uuid,
 p_received boolean,p_sealed_intact boolean)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
 o public.orders%rowtype;
 u public.pitacco_cancel_beverage_units%rowtype;
 prev public.pitacco_cancel_beverage_returns%rowtype;
 already_qty integer:=0;
 v_known numeric(18,2):=0;
 v_missing integer:=0;
 r record;
 v_original numeric;
 v_already_restored numeric;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
   raise exception 'Somente o gestor pode confirmar retorno de bebidas'
    using errcode='42501';
 end if;
 if p_request is null or p_quantity not between 1 and 20 or p_quantity is null
  or p_received is distinct from true or p_sealed_intact is distinct from true then
   raise exception 'Confirme recebimento físico e lacre intacto da bebida'
    using errcode='22023';
 end if;
 select * into o from public.orders
  where id=p_order and store_id=p_store for update;
 if not found or o.source<>'proprio' or o.status not in ('cancelled','rejected') then
   raise exception 'Pedido próprio ainda não está cancelado'
    using errcode='22023';
 end if;
 select * into u from public.pitacco_cancel_beverage_units
  where order_id=p_order and store_id=p_store and product_id=p_product;
 if not found then
   raise exception 'Bebida não identificada no aceite como industrializada e lacrada'
    using errcode='22023';
 end if;
 select * into prev from public.pitacco_cancel_beverage_returns where id=p_request;
 if found then
   if prev.order_id<>p_order or prev.store_id<>p_store or
     prev.product_id<>p_product or prev.returned_quantity<>p_quantity then
      raise exception 'Identificador de devolução usado com outros dados'
       using errcode='22023';
   end if;
   return jsonb_build_object('already',true,'return_id',prev.id,
     'returned_quantity',prev.returned_quantity);
 end if;
 select coalesce(sum(returned_quantity),0)::integer into already_qty
 from public.pitacco_cancel_beverage_returns
 where order_id=p_order and store_id=p_store and product_id=p_product;
 if already_qty+p_quantity>u.ordered_quantity then
   raise exception 'Quantidade superior às bebidas ainda recuperáveis'
    using errcode='22023';
 end if;
 if not exists(select 1 from public.pitacco_cancel_beverage_recipe
    where order_id=p_order and store_id=p_store and product_id=p_product) then
   raise exception 'Sem ficha técnica original para devolução'
    using errcode='22023';
 end if;
 -- Impede restaurar mais do que foi originalmente debitado, inclusive
 -- quando bebidas diferentes compartilham o MESMO insumo.
 for r in
   select ingredient_id,quantity_per_unit from public.pitacco_cancel_beverage_recipe
   where order_id=p_order and store_id=p_store and product_id=p_product
   order by ingredient_id
 loop
   select coalesce(-sum(quantity),0) into v_original
   from public.pitacco_stock_movements
   where order_id=p_order and store_id=p_store
     and ingredient_id=r.ingredient_id and quantity<0;
   select coalesce(sum(ret.returned_quantity*recipe.quantity_per_unit),0)
    into v_already_restored
   from public.pitacco_cancel_beverage_returns ret
   join public.pitacco_cancel_beverage_recipe recipe
     on recipe.order_id=ret.order_id and recipe.store_id=ret.store_id
      and recipe.product_id=ret.product_id and recipe.ingredient_id=r.ingredient_id
   where ret.order_id=p_order and ret.store_id=p_store;
   if v_original<=0 or v_already_restored+r.quantity_per_unit*p_quantity>v_original then
     raise exception 'Devolução maior que o consumo original'
      using errcode='22023';
   end if;
 end loop;

 select coalesce(sum(round(r.quantity_per_unit*p_quantity*r.unit_cost_at_accept,2)),0),
  count(*) filter(where r.unit_cost_at_accept is null)
 into v_known,v_missing
 from public.pitacco_cancel_beverage_recipe r
 where r.order_id=p_order and r.store_id=p_store and r.product_id=p_product;

 insert into public.pitacco_cancel_beverage_returns(
  id,order_id,store_id,product_id,returned_quantity,
  recovered_known_cost,missing_ingredient_prices,actor)
 values(p_request,p_order,p_store,p_product,p_quantity,v_known,v_missing,auth.uid());

 insert into public.pitacco_stock_movements(
  store_id,ingredient_id,quantity,reason,actor,cancellation_beverage_return_id)
 select p_store,r.ingredient_id,r.quantity_per_unit*p_quantity,
  'Retorno físico de bebida lacrada de pedido cancelado',auth.uid(),p_request
 from public.pitacco_cancel_beverage_recipe r
 where r.order_id=p_order and r.store_id=p_store and r.product_id=p_product
 order by r.ingredient_id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(p_store,p_order,auth.uid(),'cancelled_beverage_physically_returned',
  jsonb_build_object('product_id',p_product,'quantity',p_quantity,
     'return_id',p_request,'cost_recovered_known',v_known));
 return jsonb_build_object('already',false,'return_id',p_request,
  'returned_quantity',p_quantity,'known_recovered_cost',v_known);
end $function$;
revoke all on function public.pitacco_confirm_sealed_beverage_return(
 uuid,uuid,uuid,integer,uuid,boolean,boolean) from public,anon;
grant execute on function public.pitacco_confirm_sealed_beverage_return(
 uuid,uuid,uuid,integer,uuid,boolean,boolean) to authenticated;

-- Relatório de perdas está no Financeiro existente, sem módulo adicional.
-- Valores parciais são explicitamente identificados. Não deduzir custos
-- desconhecidos e não confundir venda cancelada com valor recebido.
create or replace function public.pitacco_cancelled_order_loss_report(
 p_store uuid,p_start date,p_end date,p_page integer default 0)
returns table(order_id uuid,reference text,created_at timestamptz,
 order_total numeric,known_material_cost numeric,recovered_cost numeric,
 known_material_loss numeric,complete_cost boolean,returnable_items jsonb)
language plpgsql stable security definer set search_path='' as $function$
<<losses>>
declare
 from_time timestamptz:=p_start::timestamp at time zone 'America/Sao_Paulo';
 until_time timestamptz:=(p_end+1)::timestamp at time zone 'America/Sao_Paulo';
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem permissão para consultar perdas';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365
    or p_page is null or p_page not between 0 and 10000 then
  raise exception 'Informe um período de até 366 dias';end if;
 return query
 select o.id,
 coalesce(o.receipt->>'display_number',o.receipt->>'external_order_number',
  left(o.id::text,8)),o.created_at,o.gross,
 s.estimated_known_cost,
 coalesce(returns.recovered_known_cost,0),
 case when s.order_id is null then null
   else greatest(0,s.estimated_known_cost-coalesce(returns.recovered_known_cost,0)) end,
 (s.calculated_cost is not null and coalesce(returns.missing_prices,0)=0),
 coalesce(candidates.items,'[]'::jsonb)
 from public.orders o
 left join public.pitacco_order_material_cost_summary s
   on s.order_id=o.id and s.store_id=o.store_id
 left join lateral (
    select sum(r.recovered_known_cost) recovered_known_cost,
     sum(r.missing_ingredient_prices) missing_prices
    from public.pitacco_cancel_beverage_returns r
    where r.order_id=o.id and r.store_id=o.store_id
 ) returns on true
 left join lateral (
   select jsonb_agg(jsonb_build_object(
     'product_id',u.product_id,'name',u.product_name,
     'ordered_quantity',u.ordered_quantity,
     'returned_quantity',coalesce(t.qty,0),
     'available_quantity',u.ordered_quantity-coalesce(t.qty,0))
     order by u.product_name,u.product_id) as items
   from public.pitacco_cancel_beverage_units u
   left join lateral (
    select sum(r.returned_quantity)::integer qty
    from public.pitacco_cancel_beverage_returns r
    where r.order_id=u.order_id and r.product_id=u.product_id and r.store_id=u.store_id
   ) t on true
   where u.order_id=o.id and u.store_id=o.store_id
 ) candidates on true
 where o.store_id=p_store and o.source='proprio'
   and o.status in ('cancelled','rejected')
   and o.created_at>=losses.from_time and o.created_at<losses.until_time
 order by o.created_at desc,o.id desc offset p_page*25 limit 26;
end $function$;
revoke all on function public.pitacco_cancelled_order_loss_report(
 uuid,date,date,integer) from public,anon;
grant execute on function public.pitacco_cancelled_order_loss_report(
 uuid,date,date,integer) to authenticated;
notify pgrst,'reload schema';
