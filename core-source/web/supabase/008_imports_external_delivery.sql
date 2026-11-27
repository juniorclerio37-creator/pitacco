-- Execute after 007. Import is staging-only: no publishing or API scraping.
create table if not exists public.menu_import_staging (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade,
 source_platform text not null check(source_platform in ('ifood','99food','keeta')),
 external_id text not null, name text not null, category text, description text,
 price numeric(12,2) not null check(price>=0), raw_data jsonb not null default '{}'::jsonb,
 review_status text not null default 'pendente' check(review_status in ('pendente','aprovado','rejeitado')),
 created_at timestamptz not null default now()
);
create table if not exists public.external_delivery_requests (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade,
 provider text not null check(provider in ('99entrega','uber_direct','ifood_on_demand')),
 reference text not null, customer_name text not null, destination text not null,
 status text not null default 'rascunho' check(status in ('rascunho','cotado','confirmado','em_andamento','concluido','cancelado','falhou')),
 provider_reference text, created_at timestamptz not null default now()
);
alter table public.menu_import_staging enable row level security;
alter table public.external_delivery_requests enable row level security;
create policy "menu manager read" on public.menu_import_staging for select to authenticated using(public.is_store_manager(store_id));
create policy "menu manager insert" on public.menu_import_staging for insert to authenticated with check(public.is_store_manager(store_id));
create policy "menu manager update" on public.menu_import_staging for update to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
create policy "external manager read" on public.external_delivery_requests for select to authenticated using(public.is_store_manager(store_id));
create policy "external manager draft" on public.external_delivery_requests for insert to authenticated with check(public.is_store_manager(store_id) and status='rascunho');
-- No client UPDATE policy: status transitions require a future trusted backend.
create index if not exists idx_menu_import_store on public.menu_import_staging(store_id,created_at desc);
create index if not exists idx_external_requests_store on public.external_delivery_requests(store_id,created_at desc);
