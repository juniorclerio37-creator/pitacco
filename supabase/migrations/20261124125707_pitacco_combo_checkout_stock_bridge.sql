create table pitacco_private.combo_catalog (
 product_id uuid primary key references public.products(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 draft_id uuid not null unique references public.pitacco_combo_drafts(id) on delete restrict,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 2 and 15),
 rule text not null check(rule in ('fixed','percent')),
 value integer not null check(value between 1 and 1000000),
 updated_at timestamptz not null default now()
);
alter table pitacco_private.combo_catalog enable row level security;
revoke all on pitacco_private.combo_catalog from public,anon,authenticated;
CREATE OR REPLACE FUNCTION pitacco_private.quote_pizza_combo(p_store uuid, p_items jsonb, p_rule text, p_value integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare line jsonb; p public.products%rowtype; opt jsonb; qty integer; cents bigint; total bigint:=0; count_units integer:=0; has_pizza boolean:=false; result jsonb:='[]'; final_cents bigint;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 2 and 15 or octet_length(p_items::text)>24000 then raise exception 'Inclua de 2 a 15 itens no combo';end if;
 if p_rule is null or p_rule not in ('fixed','percent') or p_value is null or p_value not between 1 and 1000000 or (p_rule='percent' and p_value>=10000) then raise exception 'Regra de preço inválida';end if;
 for line in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(line) is distinct from 'object' or (line-array['product_id','quantity','options'])<>'{}'::jsonb or coalesce(line->>'product_id','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' or jsonb_typeof(line->'quantity') is distinct from 'number' or coalesce(line->>'quantity','') !~ '^[0-9]{1,2}$' or jsonb_typeof(line->'options') is distinct from 'array' then raise exception 'Item do combo inválido';end if;
  qty:=(line->>'quantity')::integer;
  if qty not between 1 and 20 then raise exception 'Quantidade inválida';end if;
  count_units:=count_units+qty;
  if count_units>30 then raise exception 'Limite de 30 unidades por combo';end if;
  select * into p from public.products where id=(line->>'product_id')::uuid and store_id=p_store and menu_active;
  if not found then raise exception 'Produto indisponível para este combo';end if;
  if exists(select 1 from pitacco_private.combo_catalog cc where cc.product_id=p.id) then raise exception 'Não é permitido incluir outro combo';end if;
  has_pizza:=has_pizza or exists(select 1 from pitacco_private.pizza_catalog pc where pc.product_id=p.id and pc.store_id=p_store);
  opt:=public.pitacco_validate_item_options(p_store,p.id,line->'options');
  cents:=round((p.price+(opt->>'extra')::numeric)*100)::bigint;
  if cents<0 then raise exception 'Preço inválido';end if;
  total:=total+cents*qty;
  result:=result||jsonb_build_array(jsonb_build_object('product_id',p.id,'name',p.name,'quantity',qty,'options',opt->'canonical','modifiers',opt->'modifiers','unit_cents',cents));
 end loop;
 if not has_pizza then raise exception 'Inclua pelo menos uma pizza';end if;
 final_cents:=case when p_rule='fixed' then p_value else round(total*(10000-p_value)::numeric/10000)::bigint end;
 if final_cents not between 1 and 1000000 or final_cents>total then raise exception 'Preço do combo deve ser positivo e não superar a soma dos itens';end if;
 return jsonb_build_object('items',result,'subtotal_cents',total,'total_cents',final_cents,'discount_cents',total-final_cents);
end $function$;
create or replace function pitacco_private.combo_checkout_options(p_store uuid,p_product uuid,p_options jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c pitacco_private.combo_catalog%rowtype; v_price numeric; q jsonb; child jsonb; mods jsonb:='[]';
begin
 select cc.* into c from pitacco_private.combo_catalog cc join public.products p on p.id=cc.product_id and p.store_id=cc.store_id where cc.store_id=p_store and cc.product_id=p_product and p.menu_active;
 if not found then raise exception 'Combo indisponível';end if;
 if p_options is distinct from '[]'::jsonb then raise exception 'A composição deste combo é fixa';end if;
 select p.price into v_price from public.products p where p.id=p_product and p.store_id=p_store;
 q:=pitacco_private.quote_pizza_combo(p_store,c.items,c.rule,c.value);
 if v_price<>(q->>'total_cents')::numeric/100 then raise exception 'Preço do combo atualizado. Consulte a loja';end if;
 for child in select value from jsonb_array_elements(q->'items') loop
  mods:=mods||jsonb_build_array(jsonb_build_object('group','Combo','name',child->>'name','quantity',(child->>'quantity')::integer,'combo_item',child,'options',child->'modifiers'));
 end loop;
 return jsonb_build_object('modifiers',mods,'extra',0,'canonical','[]'::jsonb);
end $$;
revoke all on function pitacco_private.combo_checkout_options(uuid,uuid,jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.pitacco_validate_item_options(p_store uuid, p_product uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare grp record;opt record;entry jsonb;chosen uuid[]:=array[]::uuid[];selected_count int;extra numeric:=0;mods jsonb:='[]'::jsonb;canonical jsonb:='[]'::jsonb; pizza_result jsonb;begin
if exists(select 1 from pitacco_private.combo_catalog cc where cc.product_id=p_product) then
 return pitacco_private.combo_checkout_options(p_store,p_product,p_options);
end if;
if exists(select 1 from pitacco_private.pizza_catalog pc where pc.product_id=p_product) then
 return pitacco_private.pizza_checkout_options(p_store,p_product,p_options);
end if;
if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options)>100 then raise exception 'Complementos inválidos';end if;
for entry in select value from jsonb_array_elements(p_options) loop
if jsonb_typeof(entry)<>'string' or (entry#>>'{}') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Complemento inválido';end if;
if (entry#>>'{}')::uuid=any(chosen) then raise exception 'Complemento repetido';end if;
chosen:=array_append(chosen,(entry#>>'{}')::uuid);
end loop;
for grp in select * from public.product_option_groups where store_id=p_store and product_id=p_product order by sort_order,id loop
select count(*) into selected_count from public.product_options o where o.group_id=grp.id and o.id=any(chosen) and o.available;
if selected_count<grp.min_select or selected_count>grp.max_select then raise exception 'Quantidade de escolhas inválida no grupo %',grp.name;end if;
end loop;
for opt in select o.*,g.name as group_name from public.product_options o join public.product_option_groups g on g.id=o.group_id where o.id=any(chosen) and o.store_id=p_store and g.product_id=p_product and o.available order by g.sort_order,g.id,o.sort_order,o.id loop
extra:=extra+opt.additional_price;
mods:=mods||jsonb_build_array(jsonb_build_object('option_id',opt.id,'group',opt.group_name,'name',opt.name,'price',opt.additional_price));
canonical:=canonical||jsonb_build_array(opt.id::text);
end loop;
if jsonb_array_length(canonical)<>cardinality(chosen) then raise exception 'Complemento indisponível ou pertencente a outro produto';end if;
return jsonb_build_object('modifiers',mods,'extra',extra,'canonical',canonical);
end $function$;
create or replace function pitacco_private.expand_combo_receipt_items(p_store uuid,p_items jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare item jsonb; m jsonb; child jsonb; expanded jsonb:='[]'; parent_qty integer; child_qty integer; cid uuid;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then return '[]';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if not exists(select 1 from pitacco_private.combo_catalog cc where cc.store_id=p_store and cc.product_id::text=item->>'product_id') then
   expanded:=expanded||jsonb_build_array(item);continue;
  end if;
  if coalesce(item->>'quantity','') !~ '^[0-9]{1,2}$' or jsonb_typeof(item->'modifiers') is distinct from 'array' then raise exception 'Composição do combo inválida';end if;
  parent_qty:=(item->>'quantity')::integer;
  if parent_qty not between 1 and 20 or jsonb_array_length(item->'modifiers') not between 2 and 15 then raise exception 'Composição do combo inválida';end if;
  for m in select value from jsonb_array_elements(item->'modifiers') loop
   child:=m->'combo_item';
   if m->>'group' is distinct from 'Combo' or jsonb_typeof(child) is distinct from 'object' or coalesce(child->>'quantity','') !~ '^[0-9]{1,2}$' or coalesce(child->>'product_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Componente do combo inválido';end if;
   cid:=(child->>'product_id')::uuid;child_qty:=(child->>'quantity')::integer;
   if child_qty not between 1 and 20 or not exists(select 1 from public.products p where p.id=cid and p.store_id=p_store) or exists(select 1 from pitacco_private.combo_catalog cc where cc.product_id=cid) then raise exception 'Componente do combo inválido';end if;
   expanded:=expanded||jsonb_build_array(jsonb_set(child,'{quantity}',to_jsonb(parent_qty*child_qty)));
  end loop;
 end loop;
 return expanded;
end $$;
revoke all on function pitacco_private.expand_combo_receipt_items(uuid,jsonb) from public,anon,authenticated;
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
     case when l.item->>'quantity' ~ '^[0-9]{1,3}$'
          then (l.item->>'quantity')::integer end qty,
     case when l.item->>'product_id' ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
          then (l.item->>'product_id')::uuid end product_id
   from jsonb_array_elements(pitacco_private.expand_combo_receipt_items(new.store_id,new.receipt->'items')) l(item)
 ), consumed as (
   select b.ingredient_id,b.quantity*l.qty used_qty
   from lines l
   join public.pitacco_recipe_lines b
     on b.store_id=new.store_id and b.product_id=l.product_id
   where l.qty between 1 and 400
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
   where l.qty between 1 and 400
   union all
   select r.ingredient_id, r.quantity*l.qty*pc.fraction
   from lines l
   cross join lateral pitacco_private.pizza_receipt_components(new.store_id,l.product_id,l.item) pc
   join public.pitacco_pizza_recipe_lines r on r.store_id=new.store_id and r.product_id=l.product_id and r.size_id=pc.size_id and r.component_id=pc.component_id
   where l.qty between 1 and 400
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
 from jsonb_array_elements(pitacco_private.expand_combo_receipt_items(new.store_id,new.receipt->'items')) as l(item)
 where not exists(select 1 from pitacco_private.pizza_catalog pc where pc.store_id=new.store_id and pc.product_id::text=l.item->>'product_id')
 and not exists(
   select 1 from public.pitacco_recipe_lines r
   where r.store_id=new.store_id
     and r.product_id=case when l.item->>'product_id' ~
       '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
       then (l.item->>'product_id')::uuid end
 );

 select count(*) into v_missing_options
 from jsonb_array_elements(pitacco_private.expand_combo_receipt_items(new.store_id,new.receipt->'items')) as l(item)
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
 from jsonb_array_elements(pitacco_private.expand_combo_receipt_items(new.store_id,new.receipt->'items')) l(item)
 join pitacco_private.pizza_catalog cat on cat.store_id=new.store_id and cat.product_id::text=l.item->>'product_id'
 cross join lateral pitacco_private.pizza_receipt_components(new.store_id,cat.product_id,l.item) pc
 where not exists(select 1 from public.pitacco_pizza_recipe_lines r where r.store_id=new.store_id and r.product_id=cat.product_id and r.size_id=pc.size_id and r.component_id=pc.component_id);
 -- A malformed or legacy pizza snapshot is never marked fully costed.
 select v_missing_products+count(*) into v_missing_products
 from jsonb_array_elements(pitacco_private.expand_combo_receipt_items(new.store_id,new.receipt->'items')) l(item)
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
create or replace function public.pitacco_stage_combo(p_store uuid,p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.pitacco_combo_drafts%rowtype; q jsonb; pid uuid; v_description text; v_price numeric;
begin
 if auth.uid() is null or not coalesce(public.is_store_manager(p_store),false) then raise exception 'Sem permissão';end if;
 select * into d from public.pitacco_combo_drafts where store_id=p_store and id=p_draft for update;
 if not found then raise exception 'Combo indisponível';end if;
 q:=pitacco_private.quote_pizza_combo(p_store,d.items,d.rule,d.value);
 v_price:=(q->>'total_cents')::numeric/100;
 select string_agg((v->>'quantity')||'x '||(v->>'name'),' + ') into v_description from jsonb_array_elements(q->'items') v;
 select product_id into pid from pitacco_private.combo_catalog where store_id=p_store and draft_id=p_draft;
 if pid is null then
  insert into public.products(store_id,name,price,cost,menu_active,category,description) values(p_store,d.name,v_price,0,false,'Combos',left(v_description,1200)) returning id into pid;
  insert into pitacco_private.combo_catalog(product_id,store_id,draft_id,items,rule,value) values(pid,p_store,p_draft,d.items,d.rule,d.value);
 else
  update public.products set name=d.name,price=v_price,description=left(v_description,1200),menu_active=false where id=pid and store_id=p_store;
  update pitacco_private.combo_catalog set items=d.items,rule=d.rule,value=d.value,updated_at=now() where product_id=pid and store_id=p_store;
 end if;
 return q||jsonb_build_object('product_id',pid,'staged',true,'active',false);
end $$;
revoke all on function public.pitacco_stage_combo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_stage_combo(uuid,uuid) to authenticated;

