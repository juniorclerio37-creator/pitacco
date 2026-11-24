create table if not exists public.pitacco_pizza_flavor_library (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 180),
 description text not null default '' check(length(description)<=1200),
 ingredients text not null default '' check(length(ingredients)<=4000),
 image_url text not null default '' check(length(image_url)<=2048),
 category text not null default 'Tradicional' check(category in ('Tradicional','Especial','Premium','Doce')),
 available boolean not null default true,
 updated_at timestamptz not null default now()
);
create unique index if not exists pizza_flavor_library_store_name_category on public.pitacco_pizza_flavor_library(store_id,lower(btrim(name)),category);
alter table public.pitacco_pizza_flavor_library enable row level security;
revoke all on public.pitacco_pizza_flavor_library from public,anon,authenticated;
grant select,insert,update,delete on public.pitacco_pizza_flavor_library to authenticated;
create policy pizza_flavor_library_manager on public.pitacco_pizza_flavor_library for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));

