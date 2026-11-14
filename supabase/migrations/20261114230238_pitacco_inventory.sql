create table public.pitacco_ingredients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  unit text not null check (unit in ('g','ml','un')),
  minimum numeric(14,3) not null default 0 check (minimum >= 0),
  balance numeric(18,3) not null default 0,
  unique (store_id, id)
);
create unique index pitacco_ingredients_name_idx on public.pitacco_ingredients (store_id, lower(btrim(name)));

create table public.pitacco_recipe_lines (
  store_id uuid not null,
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 1000000),
  primary key (store_id, product_id, ingredient_id),
  foreign key (store_id, ingredient_id) references public.pitacco_ingredients(store_id, id) on delete cascade
);
create index pitacco_recipe_ingredient_idx on public.pitacco_recipe_lines (store_id, ingredient_id);

create table public.pitacco_stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  ingredient_id uuid not null,
  quantity numeric(18,3) not null check (quantity <> 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 240),
  actor uuid default auth.uid(),
  order_id uuid,
  created_at timestamptz not null default now(),
  foreign key (store_id, ingredient_id) references public.pitacco_ingredients(store_id,id) on delete cascade,
  unique (order_id, ingredient_id)
);
create index pitacco_stock_history_idx on public.pitacco_stock_movements (store_id, created_at desc, id);
create index pitacco_stock_ingredient_idx on public.pitacco_stock_movements (store_id, ingredient_id);

alter table public.pitacco_ingredients enable row level security;
alter table public.pitacco_recipe_lines enable row level security;
alter table public.pitacco_stock_movements enable row level security;

revoke all on public.pitacco_ingredients, public.pitacco_recipe_lines, public.pitacco_stock_movements from public, anon, authenticated;
grant select on public.pitacco_ingredients, public.pitacco_recipe_lines, public.pitacco_stock_movements to authenticated;
grant insert (store_id, name, unit, minimum), update (name, minimum) on public.pitacco_ingredients to authenticated;
grant insert (store_id, product_id, ingredient_id, quantity), update (quantity), delete on public.pitacco_recipe_lines to authenticated;
grant insert (id, store_id, ingredient_id, quantity, reason) on public.pitacco_stock_movements to authenticated;

create policy pitacco_ingredient_read on public.pitacco_ingredients for select to authenticated
  using (public.can_access_store(store_id));
create policy pitacco_ingredient_insert on public.pitacco_ingredients for insert to authenticated
  with check (public.is_store_manager(store_id));
create policy pitacco_ingredient_update on public.pitacco_ingredients for update to authenticated
  using (public.is_store_manager(store_id)) with check (public.is_store_manager(store_id));

create policy pitacco_recipe_read on public.pitacco_recipe_lines for select to authenticated
  using (public.can_access_store(store_id));
create policy pitacco_recipe_write on public.pitacco_recipe_lines for all to authenticated
  using (public.is_store_manager(store_id))
  with check (public.is_store_manager(store_id) and exists (
    select 1 from public.products product
    where product.id = pitacco_recipe_lines.product_id and product.store_id = pitacco_recipe_lines.store_id
  ));

create policy pitacco_stock_read on public.pitacco_stock_movements for select to authenticated
  using (public.can_access_store(store_id));
create policy pitacco_stock_manual on public.pitacco_stock_movements for insert to authenticated
  with check (public.is_store_manager(store_id) and order_id is null and actor = (select auth.uid()));

create function pitacco_private.pitacco_apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  update public.pitacco_ingredients
     set balance = balance + new.quantity
   where store_id = new.store_id and id = new.ingredient_id;
  return new;
end;
$function$;
revoke all on function pitacco_private.pitacco_apply_stock_movement() from public, anon, authenticated;
create trigger pitacco_update_stock_balance after insert on public.pitacco_stock_movements
  for each row execute function pitacco_private.pitacco_apply_stock_movement();

-- Bind public checkout lines to catalog IDs. Historical receipts retain their
-- original snapshot, including orders made before inventory was enabled.
do $migration$
declare
  checkout regprocedure;
  definition text;
  original constant text := $sql$jsonb_build_object('name',public.dg_clean_text(product.name),$sql$;
  replacement constant text := $sql$jsonb_build_object('product_id',product.id,'name',public.dg_clean_text(product.name),$sql$;
begin
  foreach checkout in array array[
    'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
    'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(checkout);
    if strpos(definition, replacement) > 0 then continue; end if;
    if strpos(definition, original) = 0 then
      raise exception 'Checkout % difere da versão de referência', checkout;
    end if;
    execute replace(definition, original, replacement);
  end loop;
end;
$migration$;

create function pitacco_private.pitacco_consume_checkout_stock() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.status <> 'accepted' or old.status = 'accepted' or new.source <> 'proprio'
     or jsonb_typeof(new.receipt->'items') is distinct from 'array'
     or not exists(select 1 from public.public_checkouts where order_id = new.id and store_id = new.store_id) then
    return new;
  end if;

  insert into public.pitacco_stock_movements (store_id, ingredient_id, quantity, reason, order_id)
  select new.store_id, recipe.ingredient_id,
    -sum(recipe.quantity * ordered.quantity),
    'Consumo ao aceitar pedido do cardápio', new.id
  from jsonb_array_elements(new.receipt->'items') as line(item)
  cross join lateral (select case when line.item->>'quantity' ~ '^[0-9]{1,2}$' then (line.item->>'quantity')::integer end as quantity) ordered
  join public.pitacco_recipe_lines recipe
    on recipe.store_id = new.store_id
   and recipe.product_id = case when line.item->>'product_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      then (line.item->>'product_id')::uuid end
  where ordered.quantity between 1 and 20
  group by recipe.ingredient_id
  order by recipe.ingredient_id
  on conflict (order_id, ingredient_id) do nothing;
  return new;
end;
$function$;
revoke all on function pitacco_private.pitacco_consume_checkout_stock() from public, anon, authenticated;
create trigger pitacco_consume_stock_after_acceptance after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function pitacco_private.pitacco_consume_checkout_stock();
