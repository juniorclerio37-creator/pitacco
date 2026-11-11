-- Store-scoped configurable courier payment policies; no retroactive edits to delivered orders.
begin;
create table if not exists public.pitacco_courier_rate_rules(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 courier_id uuid references public.couriers(id) on delete cascade,
 model text not null check(model in ('por_entrega','por_km','diaria','misto')),
 per_delivery numeric(12,2) not null default 0 check(per_delivery>=0),
 per_km numeric(12,2) not null default 0 check(per_km>=0),
 daily_rate numeric(12,2) not null default 0 check(daily_rate>=0),
 minimum_fee numeric(12,2) not null default 0 check(minimum_fee>=0),
 active boolean not null default true,
 updated_at timestamptz not null default now(),
 unique(store_id,courier_id)
);
create unique index if not exists pitacco_courier_rate_rules_store_default on public.pitacco_courier_rate_rules(store_id) where courier_id is null;
alter table public.pitacco_courier_rate_rules enable row level security;
drop policy if exists pitacco_courier_rate_rules_manager on public.pitacco_courier_rate_rules;
create policy pitacco_courier_rate_rules_manager on public.pitacco_courier_rate_rules for all to authenticated
 using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
grant select,insert,update,delete on public.pitacco_courier_rate_rules to authenticated;
commit;
