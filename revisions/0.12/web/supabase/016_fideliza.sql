-- Pitacco Fideliza+: schema inicial, não aplicar sem revisar migrações existentes.
begin;
create table if not exists public.loyalty_programs (
 store_id uuid primary key references public.stores(id) on delete cascade,
 points_enabled boolean not null default false,
 points_per_real numeric(12,4) not null default 1 check(points_per_real>=0 and points_per_real<=1000),
 min_points_to_redeem integer not null default 100 check(min_points_to_redeem>0),
 points_reward_cents integer not null default 1000 check(points_reward_cents>0),
 orders_enabled boolean not null default false,
 orders_required integer not null default 10 check(orders_required between 1 and 1000),
 orders_reward_cents integer not null default 1000 check(orders_reward_cents>0),
 updated_at timestamptz not null default now()
);
create table if not exists public.loyalty_coupons (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 code text not null check(code ~ '^[A-Z0-9_-]{3,32}$'),
 discount_type text not null check(discount_type in ('percent','fixed')),
 discount_value numeric(12,2) not null check(discount_value>0),
 minimum_order_cents integer not null default 0 check(minimum_order_cents>=0),
 max_uses integer check(max_uses>0),
 uses integer not null default 0 check(uses>=0),
 starts_at timestamptz,
 expires_at timestamptz,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(store_id,code),
 check(discount_type<>'percent' or discount_value<=100),
 check(expires_at is null or starts_at is null or expires_at>starts_at)
);
create table if not exists public.loyalty_ledger (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 customer_key text not null check(length(customer_key) between 1 and 160),
 order_id uuid references public.orders(id) on delete set null,
 event_type text not null check(event_type in ('earn','redeem','reverse','adjust')),
 points_delta integer not null,
 request_key uuid not null,
 created_at timestamptz not null default now(),
 unique(store_id,request_key)
);
create index if not exists loyalty_ledger_customer on public.loyalty_ledger(store_id,customer_key,created_at);
create table if not exists public.loyalty_coupon_redemptions (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 coupon_id uuid not null references public.loyalty_coupons(id),
 order_id uuid not null references public.orders(id),
 created_at timestamptz not null default now(),
 unique(store_id,order_id,coupon_id)
);
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_coupons enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.loyalty_coupon_redemptions enable row level security;
drop policy if exists loyalty_program_manager on public.loyalty_programs;
create policy loyalty_program_manager on public.loyalty_programs for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
drop policy if exists loyalty_coupons_manager on public.loyalty_coupons;
create policy loyalty_coupons_manager on public.loyalty_coupons for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
drop policy if exists loyalty_ledger_manager on public.loyalty_ledger;
create policy loyalty_ledger_manager on public.loyalty_ledger for select to authenticated using(public.is_store_manager(store_id));
drop policy if exists loyalty_redemptions_manager on public.loyalty_coupon_redemptions;
create policy loyalty_redemptions_manager on public.loyalty_coupon_redemptions for select to authenticated using(public.is_store_manager(store_id));
revoke all on public.loyalty_programs,public.loyalty_coupons,public.loyalty_ledger,public.loyalty_coupon_redemptions from anon;
grant select,insert,update,delete on public.loyalty_programs,public.loyalty_coupons to authenticated;
grant select on public.loyalty_ledger,public.loyalty_coupon_redemptions to authenticated;
-- Ledger writes and coupon redemptions must be performed only by verified server-side checkout transactions.
commit;
