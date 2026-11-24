alter table pitacco_private.pizza_catalog add constraint pizza_catalog_store_product_unique unique(store_id,product_id);
create table public.pitacco_pizza_recipe_lines(
 store_id uuid not null,product_id uuid not null,size_id uuid not null,component_id uuid not null,ingredient_id uuid not null,
 quantity numeric(14,3) not null check(quantity>0 and quantity<=1000000),
 primary key(store_id,product_id,size_id,component_id,ingredient_id),
 foreign key(store_id,product_id) references pitacco_private.pizza_catalog(store_id,product_id) on delete cascade,
 foreign key(store_id,ingredient_id) references public.pitacco_ingredients(store_id,id) on delete cascade
);
alter table public.pitacco_pizza_recipe_lines enable row level security;
revoke all on public.pitacco_pizza_recipe_lines from public,anon,authenticated;
grant select,insert,update,delete on public.pitacco_pizza_recipe_lines to authenticated;
create policy pizza_recipe_manager on public.pitacco_pizza_recipe_lines for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
create or replace function pitacco_private.pizza_receipt_components(p_store uuid,p_product uuid,p_item jsonb)
returns table(size_id uuid,component_id uuid,fraction numeric) language plpgsql stable security invoker set search_path='' as $$
declare mods jsonb; m jsonb; size_count integer; sid uuid;
begin
 if not exists(select 1 from pitacco_private.pizza_catalog pc where pc.store_id=p_store and pc.product_id=p_product) then return;end if;
 mods:=p_item->'modifiers';if jsonb_typeof(mods) is distinct from 'array' then return;end if;
 select count(*) into size_count from jsonb_array_elements(mods) v where v->>'group'='Tamanho' and v->>'option_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
 if size_count<>1 then return;end if;
 select (v->>'option_id')::uuid into sid from jsonb_array_elements(mods) v where v->>'group'='Tamanho' and v->>'option_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
 for m in select value from jsonb_array_elements(mods) loop
  if coalesce(m->>'option_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or coalesce(m->>'group','') not in ('Tamanho','Sabor','Borda','Massa','Adicional') then continue;end if;
  size_id:=sid;component_id:=(m->>'option_id')::uuid;fraction:=1;
  if m->>'group'='Sabor' then
   if coalesce(m->>'numerator','') !~ '^[0-9]{1,3}$' or coalesce(m->>'denominator','') !~ '^[0-9]{1,3}$' then continue;end if;
   if (m->>'numerator')::int not between 1 and (m->>'denominator')::int or (m->>'denominator')::int not between 1 and 100 then continue;end if;
   fraction:=(m->>'numerator')::numeric/(m->>'denominator')::numeric;
  end if;
  return next;
 end loop;
end $$;
revoke all on function pitacco_private.pizza_receipt_components(uuid,uuid,jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION pitacco_private.pitacco_consume_checkout_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   union all
   select r.ingredient_id, r.quantity*l.qty*pc.fraction
   from lines l
   cross join lateral pitacco_private.pizza_receipt_components(new.store_id,l.product_id,l.item) pc
   join public.pitacco_pizza_recipe_lines r on r.store_id=new.store_id and r.product_id=l.product_id and r.size_id=pc.size_id and r.component_id=pc.component_id
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
 where not exists(select 1 from pitacco_private.pizza_catalog pc where pc.store_id=new.store_id and pc.product_id::text=l.item->>'product_id')
 and not exists(
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
 where not exists(select 1 from pitacco_private.pizza_catalog pc where pc.store_id=new.store_id and pc.product_id::text=l.item->>'product_id')
 and not exists(
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

 -- Each pizza component needs a size-specific recipe. Missing recipes keep cost pending.
 select v_missing_options+count(*) into v_missing_options
 from jsonb_array_elements(new.receipt->'items') l(item)
 join pitacco_private.pizza_catalog cat on cat.store_id=new.store_id and cat.product_id::text=l.item->>'product_id'
 cross join lateral pitacco_private.pizza_receipt_components(new.store_id,cat.product_id,l.item) pc
 where not exists(select 1 from public.pitacco_pizza_recipe_lines r where r.store_id=new.store_id and r.product_id=cat.product_id and r.size_id=pc.size_id and r.component_id=pc.component_id);
 -- A malformed or legacy pizza snapshot is never marked fully costed.
 select v_missing_products+count(*) into v_missing_products
 from jsonb_array_elements(new.receipt->'items') l(item)
 join pitacco_private.pizza_catalog cat on cat.store_id=new.store_id and cat.product_id::text=l.item->>'product_id'
 where not exists(select 1 from pitacco_private.pizza_receipt_components(new.store_id,cat.product_id,l.item));
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

