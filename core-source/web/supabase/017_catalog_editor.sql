-- Catalog editor extensions. Apply after checking existing products and stores schema.
alter table public.products add column if not exists description text not null default '';
alter table public.products add column if not exists category text not null default '';
alter table public.products add column if not exists image_path text;
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists promotional_price numeric(12,2) check(promotional_price is null or promotional_price>=0);
alter table public.products add column if not exists pdv_code text;
alter table public.products add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists complement_groups jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists technical_sheet jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists special_tags text[] not null default '{}';
alter table public.products add column if not exists availability jsonb not null default '{}'::jsonb;
alter table public.products add column if not exists gallery_paths text[] not null default '{}';
alter table public.products add constraint products_promo_not_above_price check(promotional_price is null or promotional_price<=price);
-- Use private product images, store-scoped paths, and authenticated upload policies
-- before enabling photo upload. Public reads must be scoped to published products.
