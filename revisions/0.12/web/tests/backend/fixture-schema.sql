create table public.product_option_groups (
 id uuid primary key, store_id uuid not null, product_id uuid not null,
 name text not null, min_select integer not null, max_select integer not null, sort_order integer not null default 0
);
create table public.product_options (
 id uuid primary key, group_id uuid not null, store_id uuid not null,
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
create table public.pitacco_courier_payouts (store_id uuid not null, amount numeric, created_at timestamptz);
alter table public.public_menu_settings add column preparation_minutes integer not null default 30;

create table public.marketplace_acceptance_requests (
 id uuid primary key, store_id uuid not null, order_id uuid, source text, state text,
 created_at timestamptz not null default now(), confirmed_at timestamptz
);
