-- Pitacco caderneta digital: isolamento por estabelecimento e operações somente via RPC autorizadas.
create table if not exists public.pitacco_fiado_settings (
 store_id uuid primary key references public.stores(id) on delete cascade,
 enabled boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.pitacco_fiado_customers (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 120),
 phone text not null check(phone ~ '^[0-9]{10,13}$'),
 enabled boolean not null default false,
 credit_limit numeric(12,2) not null default 0 check (credit_limit >= 0 and credit_limit <= 100000),
 used numeric(12,2) not null default 0 check(used>=0),
 due_days integer not null default 7 check (due_days between 1 and 365),
 approval_mode text not null default 'automatic' check(approval_mode in ('automatic','manual')),
 block_overdue boolean not null default true,
 credential_salt text not null default replace(gen_random_uuid()::text,'-',''),
 credential_hash text,
 credential_bad_attempts integer not null default 0,
 credential_locked_until timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(store_id,phone),
 unique(store_id,id)
);
create table if not exists public.pitacco_fiado_charges(
 order_id uuid primary key references public.orders(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 customer_id uuid not null,
 amount numeric(12,2) not null check(amount>0),
 paid numeric(12,2) not null default 0 check(paid>=0 and paid<=amount),
 state text not null default 'reserved'
  check(state in ('reserved','open','settled','cancelled')),
 approval_required boolean not null default false,
 approved_at timestamptz,
 due_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (store_id,customer_id)
  references public.pitacco_fiado_customers(store_id,id) on delete restrict
);
create index if not exists pitacco_fiado_charges_store_due
 on public.pitacco_fiado_charges(store_id,state,due_at);
create index if not exists pitacco_fiado_charges_customer
 on public.pitacco_fiado_charges(store_id,customer_id,state);
create table if not exists public.pitacco_fiado_payments(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 customer_id uuid not null,
 request_id uuid not null,
 amount numeric(12,2) not null check(amount>0),
 method text not null check(method in ('pix','dinheiro','cartao','outro')),
 note text not null default '',
 recorded_by uuid not null,
 created_at timestamptz not null default now(),
 unique(store_id,request_id),
 foreign key(store_id,customer_id)
  references public.pitacco_fiado_customers(store_id,id) on delete restrict
);
create table if not exists public.pitacco_fiado_allocations(
 payment_id uuid not null references public.pitacco_fiado_payments(id) on delete cascade,
 order_id uuid not null references public.pitacco_fiado_charges(order_id) on delete restrict,
 amount numeric(12,2) not null check(amount>0),
 primary key(payment_id,order_id)
);

alter table public.pitacco_fiado_settings enable row level security;
alter table public.pitacco_fiado_customers enable row level security;
alter table public.pitacco_fiado_charges enable row level security;
alter table public.pitacco_fiado_payments enable row level security;
alter table public.pitacco_fiado_allocations enable row level security;
revoke all on public.pitacco_fiado_settings from public,anon,authenticated;
revoke all on public.pitacco_fiado_customers from public,anon,authenticated;
revoke all on public.pitacco_fiado_charges from public,anon,authenticated;
revoke all on public.pitacco_fiado_payments from public,anon,authenticated;
revoke all on public.pitacco_fiado_allocations from public,anon,authenticated;
