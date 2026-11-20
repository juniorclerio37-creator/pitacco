-- The production stores table includes editable street-address and pin columns.
-- CI's historical schema predates those fields; represent them before loading
-- new migrations that invalidate the map point after an address edit.
alter table public.stores
 add column if not exists address text,
 add column if not exists address_number text,
 add column if not exists neighborhood text,
 add column if not exists city text,
 add column if not exists state text,
 add column if not exists postal_code text,
 add column if not exists latitude double precision,
 add column if not exists longitude double precision;

create table public.product_option_groups (
 id uuid primary key default gen_random_uuid(), store_id uuid not null, product_id uuid not null,
 name text not null, min_select integer not null, max_select integer not null, sort_order integer not null default 0
);
create table public.product_options (
 id uuid primary key default gen_random_uuid(), group_id uuid not null, store_id uuid not null,
 name text not null, additional_price numeric not null, available boolean not null default true, sort_order integer not null default 0
);
create table public.store_customer_branding (store_id uuid primary key, logo_url text, primary_color text);
create table public.pitacco_signup_trials (
 user_id uuid primary key, first_store_id uuid not null unique, started_at timestamptz not null default now(),
 ends_at timestamptz not null default (now()+interval '30 days')
);
create schema pitacco_private;
create table pitacco_private.identity_secret (id boolean primary key, pepper text not null);
insert into pitacco_private.identity_secret values (true, 'test-only-secret');
create table pitacco_private.trial_identity_registry (
 identity_kind text, identity_hash text, first_user_id uuid, first_store_id uuid,
 first_trial_started_at timestamptz, primary key (identity_kind, identity_hash)
);
create function pitacco_private.valid_document(document text) returns boolean language sql immutable as
$$ select length(document) in (11,14) $$;
create schema extensions;
create function extensions.hmac(document text, key text, algorithm text) returns bytea language sql immutable as
$$ select convert_to(md5(document || key || algorithm), 'UTF8') $$;
create table public.store_payment_receipts (
 order_id uuid not null references public.orders(id), store_id uuid, amount numeric, recorded_at timestamptz
);
create table public.pitacco_courier_payouts (store_id uuid not null, amount numeric, period_start date, period_end date, created_at timestamptz);
create table public.pitacco_order_costs (
 order_id uuid primary key, store_id uuid not null, merchant_discount numeric not null default 0,
 processing_fees numeric not null default 0, delivery_cost numeric not null default 0,
 goods_cost numeric not null default 0, other_cost numeric not null default 0
);
alter table public.public_menu_settings add column preparation_minutes integer not null default 30;

create table public.marketplace_acceptance_requests (
 id uuid primary key, store_id uuid not null, order_id uuid, source text, state text, external_order_id text,
 provider_confirmation_id text, provider_message text,
 created_at timestamptz not null default now(), confirmed_at timestamptz
);

-- Production already contains this store sound setting table; the isolated CI
-- schema needs a representative fixture so repair RPC tests can exercise it.
create table public.pitacco_store_sound_settings (
 store_id uuid primary key references public.stores(id) on delete cascade,
 enabled boolean not null default false,
 volume integer not null default 60 check (volume between 0 and 100),
 updated_at timestamptz not null default now()
);
alter table public.pitacco_store_sound_settings enable row level security;
revoke all on public.pitacco_store_sound_settings from public,anon,authenticated;
