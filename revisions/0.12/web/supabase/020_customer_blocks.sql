-- Per-store customer restrictions. Apply only after reviewing existing stores/auth schema.
begin;
create table if not exists public.store_customer_blocks (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 match_type text not null check(match_type in ('name','phone','address')),
 match_value text not null check(length(trim(match_value)) between 3 and 300),
 reason text not null check(length(trim(reason)) between 3 and 1000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 revoked_at timestamptz,
 revoked_by uuid references auth.users(id),
 check(expires_at is null or expires_at>created_at)
);
create index if not exists store_customer_blocks_lookup on public.store_customer_blocks(store_id,match_type,match_value) where revoked_at is null;
alter table public.store_customer_blocks enable row level security;
drop policy if exists store_customer_blocks_manager on public.store_customer_blocks;
create policy store_customer_blocks_manager on public.store_customer_blocks
 for select to authenticated using(public.is_store_manager(store_id));
-- Mutations must go through server RPCs validating manager membership, auditing changes,
-- normalizing phone/address, and enforcing store_id scope.
revoke all on public.store_customer_blocks from anon,authenticated;
grant select on public.store_customer_blocks to authenticated;
-- Never expose this table directly to public catalog clients.
-- Checkout must verify active blocks server-side, before order creation.
commit;
