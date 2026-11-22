-- Pitacco: custo de insumos, complementos e embalagens integrado ao lucro.
-- Sem retroatividade, sem custos presumidos, sem alteração do Fideliza+.

-- Custos por unidade de estoque: R$/g, R$/ml ou R$/un.
-- Tabela separada para que funcionários que só consultam estoque não vejam preços.
create table public.pitacco_ingredient_unit_costs(
 store_id uuid not null,
 ingredient_id uuid not null,
 cost_per_unit numeric(18,6) not null check(cost_per_unit>=0 and cost_per_unit<=100000),
 updated_at timestamptz not null default now(),
 primary key(store_id,ingredient_id),
 foreign key(store_id,ingredient_id)
  references public.pitacco_ingredients(store_id,id) on delete cascade
);
alter table public.pitacco_ingredient_unit_costs enable row level security;
revoke all on public.pitacco_ingredient_unit_costs from public,anon,authenticated;
grant select,insert,update,delete on public.pitacco_ingredient_unit_costs to authenticated;
create policy pitacco_ingredient_unit_costs_manager
 on public.pitacco_ingredient_unit_costs for all to authenticated
 using(public.is_store_manager(store_id))
 with check(public.is_store_manager(store_id));

-- Snapshot imutável por insumo/por pedido. Não recalcular quando preços mudarem.
create table public.pitacco_order_material_cost_lines(
 order_id uuid not null references public.orders(id) on delete cascade,
 store_id uuid not null,
 ingredient_id uuid not null,
 ingredient_name text not null,
 stock_unit text not null,
 consumed_quantity numeric(18,3) not null check(consumed_quantity>0),
 unit_cost numeric(18,6) check(unit_cost>=0),
 calculated_cost numeric(18,2) check(calculated_cost>=0),
 created_at timestamptz not null default now(),
 primary key(order_id,ingredient_id),
 foreign key(store_id,ingredient_id)
  references public.pitacco_ingredients(store_id,id)
);
create index pitacco_material_lines_store_order
 on public.pitacco_order_material_cost_lines(store_id,order_id);
alter table public.pitacco_order_material_cost_lines enable row level security;
revoke all on public.pitacco_order_material_cost_lines from public,anon,authenticated;
grant select on public.pitacco_order_material_cost_lines to authenticated;
create policy pitacco_material_lines_manager
 on public.pitacco_order_material_cost_lines for select to authenticated
 using(public.is_store_manager(store_id));

create table public.pitacco_order_material_cost_summary(
 order_id uuid primary key references public.orders(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 estimated_known_cost numeric(18,2) not null default 0 check(estimated_known_cost>=0),
 calculated_cost numeric(18,2) check(calculated_cost>=0),
 movement_count integer not null check(movement_count>=0),
 missing_product_recipes integer not null default 0 check(missing_product_recipes>=0),
 missing_option_recipes integer not null default 0 check(missing_option_recipes>=0),
 missing_ingredient_prices integer not null default 0 check(missing_ingredient_prices>=0),
 created_at timestamptz not null default now()
);
create index pitacco_material_summary_store_order
 on public.pitacco_order_material_cost_summary(store_id,order_id);
alter table public.pitacco_order_material_cost_summary enable row level security;
revoke all on public.pitacco_order_material_cost_summary from public,anon,authenticated;
grant select on public.pitacco_order_material_cost_summary to authenticated;
create policy pitacco_material_summary_manager
 on public.pitacco_order_material_cost_summary for select to authenticated
 using(public.is_store_manager(store_id));

-- Substitui apenas a função existente de consumo de estoque, mantendo seu
-- cálculo de insumos e o ON CONFLICT (idempotência). O snapshot só nasce quando
-- a loja aceita o pedido e é feito dentro da mesma transação da baixa.
create or replace function pitacco_private.pitacco_consume_checkout_stock()
returns trigger language plpgsql security definer set search_path='' as $function$
declare
 v_missing_products integer:=0;
 v_missing_options integer:=0;
 v_missing_prices integer:=0;
 v_movement_count integer:=0;
 v_known numeric(18,2):=0;
begin
 if new.status <> 'accepted' or old.status = 'accepted' or new.source <> 'proprio'
    or jsonb_typeof(new.receipt->'items') is distinct from 'array'
    or not (
      exists(select 1 from public.public_checkouts c
        where c.order_id=new.id and c.store_id=new.store_id)
      or (
        new.receipt->>'point_of_sale'='true'
        and new.receipt->>'payment'='fiado'
        and exists(select 1 from public.pitacco_fiado_charges c
          where c.order_id=new.id and c.store_id=new.store_id)
      )
    ) then
    return new;
 end if;

 insert into public.pitacco_stock_movements
   (store_id,ingredient_id,quantity,reason,order_id)
 with lines as (
   select l.item,
     case when l.item->>'quantity' ~ '^[0-9]{1,2}$'
          then (l.item->>'quantity')::integer end qty,
     case when l.item->>'product_id' ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
          then (l.item->>'product_id')::uuid end product_id
   from jsonb_array_elements(new.receipt->'items') l(item)
 ), consumed as (
   select b.ingredient_id,b.quantity*l.qty used_qty
   from lines l
   join public.pitacco_recipe_lines b
     on b.store_id=new.store_id and b.product_id=l.product_id
   where l.qty between 1 and 20
   union all
   select r.ingredient_id,r.quantity*l.qty
   from lines l
   cross join lateral jsonb_array_elements(
     case when jsonb_typeof(l.item->'modifiers')='array'
          then l.item->'modifiers' else '[]'::jsonb end
   ) selected(modifier)
   join public.pitacco_option_recipe_lines r
     on r.store_id=new.store_id
    and r.option_id=case when selected.modifier->>'option_id' ~
      '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then (selected.modifier->>'option_id')::uuid end
   join public.product_options po
     on po.id=r.option_id and po.store_id=r.store_id
   join public.product_option_groups g
     on g.id=po.group_id and g.store_id=po.store_id and g.product_id=l.product_id
   where l.qty between 1 and 20
 )
 select new.store_id,consumed.ingredient_id,
  -sum(consumed.used_qty),
  'Consumo ao aceitar pedido (produto e complementos)',new.id
 from consumed
 group by consumed.ingredient_id
 having sum(consumed.used_qty)>0
 order by consumed.ingredient_id
 on conflict(order_id,ingredient_id) do nothing;

 -- O primeiro movimento de cada insumo fixa quantidade e preço vigente.
 insert into public.pitacco_order_material_cost_lines(
  order_id,store_id,ingredient_id,ingredient_name,stock_unit,
  consumed_quantity,unit_cost,calculated_cost)
 select new.id,new.store_id,m.ingredient_id,i.name,i.unit,
   -m.quantity,c.cost_per_unit,
   case when c.cost_per_unit is not null
    then round((-m.quantity)*c.cost_per_unit,2) end
 from public.pitacco_stock_movements m
 join public.pitacco_ingredients i on i.id=m.ingredient_id and i.store_id=m.store_id
 left join public.pitacco_ingredient_unit_costs c
   on c.store_id=m.store_id and c.ingredient_id=m.ingredient_id
 where m.order_id=new.id and m.store_id=new.store_id and m.quantity<0
 on conflict(order_id,ingredient_id) do nothing;

 -- Cobertura da ficha técnica no instante do aceite. Uma ficha ausente
 -- impede informar lucro "certo", mesmo que outros insumos tenham preço.
 select count(*) into v_missing_products
 from jsonb_array_elements(new.receipt->'items') as l(item)
 where not exists(
   select 1 from public.pitacco_recipe_lines r
   where r.store_id=new.store_id
     and r.product_id=case when l.item->>'product_id' ~
       '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
       then (l.item->>'product_id')::uuid end
 );

 select count(*) into v_missing_options
 from jsonb_array_elements(new.receipt->'items') as l(item)
 cross join lateral jsonb_array_elements(
  case when jsonb_typeof(l.item->'modifiers')='array'
   then l.item->'modifiers' else '[]'::jsonb end
 ) as sel(modifier)
 where not exists(
   select 1 from public.pitacco_option_recipe_lines r
   join public.product_options po
     on po.store_id=r.store_id and po.id=r.option_id
   join public.product_option_groups g
     on g.id=po.group_id and g.store_id=po.store_id
   where r.store_id=new.store_id
    and g.product_id=case when l.item->>'product_id' ~
      '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then (l.item->>'product_id')::uuid end
    and r.option_id=case when sel.modifier->>'option_id' ~
      '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then (sel.modifier->>'option_id')::uuid end
 );

 select count(*),count(*) filter(where unit_cost is null),
   coalesce(sum(calculated_cost),0)::numeric(18,2)
 into v_movement_count,v_missing_prices,v_known
 from public.pitacco_order_material_cost_lines
 where order_id=new.id and store_id=new.store_id;

 insert into public.pitacco_order_material_cost_summary(
   order_id,store_id,estimated_known_cost,calculated_cost,movement_count,
   missing_product_recipes,missing_option_recipes,missing_ingredient_prices)
 values(new.id,new.store_id,v_known,
   case when v_movement_count>0 and v_missing_products=0 and
             v_missing_options=0 and v_missing_prices=0 then v_known end,
   v_movement_count,v_missing_products,v_missing_options,v_missing_prices)
 on conflict(order_id) do nothing;
 return new;
end $function$;

-- Mesma assinatura, mantendo o contrato que já é usado no painel.
-- Custo manual (quando cadastrado) prevalece sobre o cálculo automático.
-- Custos de taxa/entrega/outros não cadastrados continuam NULOS: lucro
-- permanecerá pendente até que o lojista complete os valores necessários.
create or replace function public.pitacco_order_profit_report(
 p_store uuid,p_start date,p_end date,p_page integer default 0)
returns table(
 order_id uuid,reference text,created_at timestamptz,channel text,gross numeric,
 fees numeric,goods_cost numeric,processing_fees numeric,delivery_cost numeric,
 other_cost numeric,merchant_discount numeric,direct_cost numeric,result numeric)
language plpgsql stable security definer set search_path='' as $function$
<<report>>
declare
 from_time timestamptz := p_start::timestamp at time zone 'America/Sao_Paulo';
 until_time timestamptz := (p_end+1)::timestamp at time zone 'America/Sao_Paulo';
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem permissão para consultar os pedidos desta loja' using errcode='42501';
 end if;
 if p_start is null or p_end is null or p_end < p_start or p_end-p_start>365
    or p_page is null or p_page not between 0 and 10000 then
  raise exception 'Informe um período de até 366 dias' using errcode='22023';
 end if;
 return query
 select o.id,
  coalesce(o.receipt->>'display_number',o.receipt->>'external_order_number',left(o.id::text,8)),
  o.created_at,o.channel,o.gross,coalesce(o.fees,0),
  effective.goods_cost,c.processing_fees,c.delivery_cost,c.other_cost,c.merchant_discount,
  amount.direct,o.gross-coalesce(o.fees,0)-amount.direct
 from public.orders o
 left join public.pitacco_order_costs c on c.order_id=o.id and c.store_id=o.store_id
 left join public.pitacco_order_material_cost_summary m
   on m.order_id=o.id and m.store_id=o.store_id
 cross join lateral (
   select coalesce(c.goods_cost,m.calculated_cost) as goods_cost
 ) effective
 cross join lateral (
   select effective.goods_cost+c.processing_fees+c.delivery_cost+c.other_cost as direct
 ) amount
 where o.store_id=p_store and o.status in ('accepted','historical')
   and o.created_at>=report.from_time and o.created_at<report.until_time
 order by o.created_at desc,o.id desc offset p_page*25 limit 26;
end $function$;

-- RPC exclusiva do gestor para explicar o cálculo e listar preços faltantes.
create or replace function public.pitacco_order_cost_breakdown(p_store uuid,p_order uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare s public.pitacco_order_material_cost_summary%rowtype;
 c public.pitacco_order_costs%rowtype;
 found_order boolean;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Acesso restrito ao gestor' using errcode='42501';
 end if;
 select exists(select 1 from public.orders where id=p_order and store_id=p_store)
   into found_order;
 if not found_order then raise exception 'Pedido não pertence a esta loja' using errcode='42501'; end if;
 select * into s from public.pitacco_order_material_cost_summary
 where order_id=p_order and store_id=p_store;
 select * into c from public.pitacco_order_costs
 where order_id=p_order and store_id=p_store;
 return jsonb_build_object(
   'status',case when c.goods_cost is not null then 'manual'
     when s.calculated_cost is not null then 'automatic' else 'pending' end,
   'manual_goods_cost',c.goods_cost,'automatic_goods_cost',s.calculated_cost,
   'known_partial_cost',s.estimated_known_cost,
   'movement_count',coalesce(s.movement_count,0),
   'missing_product_recipes',coalesce(s.missing_product_recipes,0),
   'missing_option_recipes',coalesce(s.missing_option_recipes,0),
   'missing_ingredient_prices',coalesce(s.missing_ingredient_prices,0),
   'ingredients',coalesce((
      select jsonb_agg(jsonb_build_object(
       'name',m.ingredient_name,'unit',m.stock_unit,
       'quantity',m.consumed_quantity,'unit_cost',m.unit_cost,
       'line_cost',m.calculated_cost,
       'missing_price',m.unit_cost is null
      ) order by m.ingredient_name)
      from public.pitacco_order_material_cost_lines m
      where m.store_id=p_store and m.order_id=p_order
    ),'[]'::jsonb));
end $function$;
revoke all on function public.pitacco_order_cost_breakdown(uuid,uuid)
 from public,anon;
grant execute on function public.pitacco_order_cost_breakdown(uuid,uuid)
 to authenticated;
notify pgrst,'reload schema';
