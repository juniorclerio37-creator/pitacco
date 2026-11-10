-- v0.13 courier pay policies. Draft migration: deploy only after payout integration tests.
begin;
create table if not exists public.pitacco_courier_pay_rules(
 store_id uuid not null references public.stores(id) on delete cascade,
 courier_id uuid not null references public.couriers(id) on delete cascade,
 mode text not null check(mode in ('customer_fee','per_km','per_delivery','daily','mixed')),
 rate numeric(12,2) not null default 0 check(rate>=0),
 daily_rate numeric(12,2) not null default 0 check(daily_rate>=0),
 km_rate numeric(12,2) not null default 0 check(km_rate>=0),
 per_delivery_rate numeric(12,2) not null default 0 check(per_delivery_rate>=0),
 include_customer_fee boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(store_id,courier_id)
);
alter table public.pitacco_courier_pay_rules enable row level security;
drop policy if exists pitacco_courier_pay_rules_manager on public.pitacco_courier_pay_rules;
create policy pitacco_courier_pay_rules_manager on public.pitacco_courier_pay_rules
 for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
create or replace function public.pitacco_validate_courier_pay_rule()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.couriers c where c.id=new.courier_id and c.store_id=new.store_id) then raise exception 'Entregador nao pertence a loja';end if;
 new.updated_at=now();return new;
end $$;
drop trigger if exists pitacco_validate_courier_pay_rule on public.pitacco_courier_pay_rules;
create trigger pitacco_validate_courier_pay_rule before insert or update on public.pitacco_courier_pay_rules for each row execute function public.pitacco_validate_courier_pay_rule();
-- Snapshot each delivered order's pay rule and store-to-customer road distance, never recompute past amounts.
create table if not exists public.pitacco_delivery_pay_snapshots(
 delivery_id uuid primary key references public.deliveries(id) on delete restrict,
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 road_distance_km numeric(10,3) check(road_distance_km>=0),
 pay_mode text not null,
 rule_snapshot jsonb not null,
 delivery_amount numeric(12,2) not null check(delivery_amount>=0),
 calculated_at timestamptz not null default now()
);
alter table public.pitacco_delivery_pay_snapshots enable row level security;
drop policy if exists pitacco_delivery_pay_snapshots_manager on public.pitacco_delivery_pay_snapshots;
create policy pitacco_delivery_pay_snapshots_manager on public.pitacco_delivery_pay_snapshots for select to authenticated using(public.is_store_manager(store_id));
-- Daily allowances must be recorded once per courier/date, not once per delivery.
create table if not exists public.pitacco_courier_daily_allowances(
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 work_date date not null,
 amount numeric(12,2) not null check(amount>=0),
 rule_snapshot jsonb not null,
 primary key(store_id,courier_id,work_date)
);
alter table public.pitacco_courier_daily_allowances enable row level security;
drop policy if exists pitacco_courier_daily_allowances_manager on public.pitacco_courier_daily_allowances;
create policy pitacco_courier_daily_allowances_manager on public.pitacco_courier_daily_allowances for select to authenticated using(public.is_store_manager(store_id));
commit;
