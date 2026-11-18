-- Some isolated CI fixtures contain the historic delivery schema without
-- the courier finance tables provisioned in the live Supabase database.
-- Idempotent schema compatibility: existing production data is NOT changed.
create table if not exists public.pitacco_courier_pay_rules(
 store_id uuid not null references public.stores(id) on delete cascade,
 courier_id uuid not null references public.couriers(id) on delete cascade,
 mode text not null default 'per_delivery'
  check(mode in ('customer_fee','per_km','per_delivery','daily','mixed')),
 rate numeric(12,2) not null default 0 check(rate>=0),
 daily_rate numeric(12,2) not null default 0 check(daily_rate>=0),
 km_rate numeric(12,2) not null default 0 check(km_rate>=0),
 per_delivery_rate numeric(12,2) not null default 0 check(per_delivery_rate>=0),
 include_customer_fee boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key (store_id,courier_id)
);
create table if not exists public.pitacco_delivery_pay_snapshots(
 delivery_id uuid primary key references public.deliveries(id) on delete restrict,
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 road_distance_km numeric(12,3) check(road_distance_km>=0),
 pay_mode text,
 rule_snapshot jsonb not null default '{}'::jsonb,
 delivery_amount numeric(12,2) not null default 0 check(delivery_amount>=0),
 calculated_at timestamptz not null default now()
);
create table if not exists public.pitacco_courier_daily_allowances(
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 work_date date not null,
 amount numeric(12,2) not null default 0 check(amount>=0),
 rule_snapshot jsonb not null default '{}'::jsonb,
 primary key (store_id,courier_id,work_date)
);
create table if not exists public.pitacco_courier_payouts(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 amount numeric(12,2) not null check(amount>0),
 period_start date not null,
 period_end date not null,
 note text not null default '',
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid(),
 check(period_end>=period_start)
);
-- Restrict the tables created by the compatibility migration just as the
-- existing production finance schema does. Idempotent on production.
alter table public.pitacco_courier_pay_rules enable row level security;
alter table public.pitacco_delivery_pay_snapshots enable row level security;
alter table public.pitacco_courier_daily_allowances enable row level security;
alter table public.pitacco_courier_payouts enable row level security;
