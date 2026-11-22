-- Completa o ESTOQUE existente sem criar módulo novo.
-- O estoque antigo não é recalculado. Pedidos futuros registram a identidade
-- do complemento no snapshot validado no servidor.
alter table public.product_options add constraint pitacco_product_options_store_id_unique unique(store_id,id);

create table public.pitacco_option_recipe_lines(
 store_id uuid not null,
 option_id uuid not null,
 ingredient_id uuid not null,
 quantity numeric(14,3) not null check(quantity>0 and quantity<=1000000),
 primary key(store_id,option_id,ingredient_id),
 foreign key(store_id,option_id) references public.product_options(store_id,id) on delete cascade,
 foreign key(store_id,ingredient_id) references public.pitacco_ingredients(store_id,id) on delete cascade
);
create index pitacco_option_recipe_ingredient_idx
 on public.pitacco_option_recipe_lines(store_id,ingredient_id);
alter table public.pitacco_option_recipe_lines enable row level security;
revoke all on public.pitacco_option_recipe_lines from public,anon,authenticated;
grant select,insert,update,delete on public.pitacco_option_recipe_lines to authenticated;
create policy pitacco_option_recipe_read on public.pitacco_option_recipe_lines for select to authenticated
 using (public.can_access_store(store_id));
create policy pitacco_option_recipe_write on public.pitacco_option_recipe_lines for all to authenticated
 using (public.is_store_manager(store_id))
 with check (public.is_store_manager(store_id));

-- O checkout já valida cada complemento; adicionamos a ID ao recibo.
-- Os campos antigos (group,name,price) permanecem intactos.
CREATE OR REPLACE FUNCTION public.pitacco_validate_item_options(p_store uuid, p_product uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare grp record;opt record;entry jsonb;chosen uuid[]:=array[]::uuid[];selected_count int;extra numeric:=0;mods jsonb:='[]'::jsonb;canonical jsonb:='[]'::jsonb;begin
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


create or replace function pitacco_private.pitacco_consume_checkout_stock()
returns trigger language plpgsql security definer set search_path='' as $body$
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

 -- Um movimento consolidado por insumo e por pedido. A chave
 -- (order_id,ingredient_id) torna a baixa idempotente em reaceite/retries.
 -- Modificadores antigos sem option_id são ignorados: nunca inferir
 -- um insumo por nomes históricos que podem ter sido renomeados.
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
 return new;
end $body$;

notify pgrst,'reload schema';
