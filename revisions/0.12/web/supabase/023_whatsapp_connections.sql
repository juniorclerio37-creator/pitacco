-- Central Meta integration, separate store authorization. Run after 021/022.
begin;
create table if not exists public.store_whatsapp_connections (
 store_id uuid primary key references public.stores(id) on delete cascade,
 waba_id text not null,
 phone_number_id text not null unique,
 display_phone_number text,
 connection_status text not null default 'pending' check(connection_status in ('pending','connected','disconnected','error')),
 connected_at timestamptz,
 disconnected_at timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists whatsapp_connections_waba on public.store_whatsapp_connections(waba_id);
alter table public.store_whatsapp_connections enable row level security;
drop policy if exists whatsapp_connections_manager_read on public.store_whatsapp_connections;
create policy whatsapp_connections_manager_read on public.store_whatsapp_connections
 for select to authenticated using (public.is_store_manager(store_id));
revoke all on public.store_whatsapp_connections from public,anon,authenticated;
grant select on public.store_whatsapp_connections to authenticated;
-- Never store Meta access tokens in browser-readable tables.
-- Backend must verify signed OAuth exchange, state, store membership, WABA permissions,
-- and subscribe the WABA before writing this table via service-role connection.
-- Revocation/disconnect is server-only; server must invalidate its token mapping.
commit;
