-- Per-store branding and product images. Requires public.is_store_manager(uuid).
begin;
alter table public.stores add column if not exists logo_path text;
alter table public.stores add column if not exists address text not null default '';
alter table public.stores add column if not exists address_number text not null default '';
alter table public.stores add column if not exists neighborhood text not null default '';
alter table public.stores add column if not exists city text not null default '';
alter table public.stores add column if not exists state text not null default '';
alter table public.stores add column if not exists postal_code text not null default '';
alter table public.stores add column if not exists phone text not null default '';
alter table public.stores add column if not exists description text not null default '';
alter table public.stores add column if not exists updated_at timestamptz not null default now();
alter table public.stores enable row level security;
alter table public.products enable row level security;
drop policy if exists pitacco_store_update_scope on public.stores;
create policy pitacco_store_update_scope on public.stores as restrictive for update to authenticated using(public.is_store_manager(id)) with check(public.is_store_manager(id));
drop policy if exists pitacco_product_update_scope on public.products;
create policy pitacco_product_update_scope on public.products as restrictive for update to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('pitacco-media','pitacco-media',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists pitacco_media_store_upload on storage.objects;
create policy pitacco_media_store_upload on storage.objects for insert to authenticated
with check(bucket_id='pitacco-media' and (storage.foldername(name))[1] in ('stores','products')
and public.is_store_manager(((storage.foldername(name))[2])::uuid));
drop policy if exists pitacco_media_store_update on storage.objects;
create policy pitacco_media_store_update on storage.objects for update to authenticated
using(bucket_id='pitacco-media' and public.is_store_manager(((storage.foldername(name))[2])::uuid))
with check(bucket_id='pitacco-media' and public.is_store_manager(((storage.foldername(name))[2])::uuid));
drop policy if exists pitacco_media_store_delete on storage.objects;
create policy pitacco_media_store_delete on storage.objects for delete to authenticated
using(bucket_id='pitacco-media' and public.is_store_manager(((storage.foldername(name))[2])::uuid));
commit;
