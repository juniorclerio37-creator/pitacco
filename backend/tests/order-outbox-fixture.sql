-- CI ONLY: atomic invalidation, no order payload or external publication.
create table core_auth.order_invalidation_fixture (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references core_auth.stores(id),
 resource text not null default 'orders' check(resource='orders'),
 created_at timestamptz not null default clock_timestamp()
);
revoke all on core_auth.order_invalidation_fixture from public,anon,authenticated,pitacco_core_actions;
create function core_auth.capture_order_invalidation_fixture() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if current_setting('pitacco.core_order_outbox',true) is distinct from 'on'
 or new.source is distinct from 'proprio'
 or (new.status is not distinct from old.status and new.preparation_status is not distinct from old.preparation_status)
 then return new;end if;
 if not core_auth.can_act(new.store_id) then
  raise exception 'Escopo de evento não autorizado' using errcode='42501';
 end if;
 insert into core_auth.order_invalidation_fixture(store_id) values(new.store_id);
 return new;
end $fn$;
revoke all on function core_auth.capture_order_invalidation_fixture() from public,anon,authenticated,pitacco_core_actions;
create trigger core_order_invalidation_fixture after update of status,preparation_status on public.orders
for each row execute function core_auth.capture_order_invalidation_fixture();

-- CI worker has access only to the synthetic invalidation queue, not orders.
alter table core_auth.order_invalidation_fixture add column published_at timestamptz;
create role pitacco_core_outbox login password 'ci-outbox-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_outbox;
grant select,update(published_at) on core_auth.order_invalidation_fixture to pitacco_core_outbox;
alter table core_auth.order_invalidation_fixture enable row level security;
create policy core_outbox_fixture_read on core_auth.order_invalidation_fixture for select to pitacco_core_outbox
 using (store_id='20000000-0000-4000-8000-000000000001');
create policy core_outbox_fixture_ack on core_auth.order_invalidation_fixture for update to pitacco_core_outbox
 using (store_id='20000000-0000-4000-8000-000000000001' and published_at is null)
 with check (store_id='20000000-0000-4000-8000-000000000001' and published_at is not null);
create index core_order_invalidation_pending on core_auth.order_invalidation_fixture(created_at,id) where published_at is null;
