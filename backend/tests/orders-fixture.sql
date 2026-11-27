-- Synthetic CI only. The real operational query is applied separately, unchanged.
create role anon nologin;
create role authenticated nologin;
create role pitacco_core_orders login password 'ci-orders-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant authenticated to pitacco_core_orders;
create schema auth;
create function auth.uid() returns uuid language sql stable set search_path='' as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
revoke all on schema auth from public;
grant usage on schema auth to authenticated;
revoke all on function auth.uid() from public;
grant execute on function auth.uid() to authenticated;
-- Test-only bridge: validate both live session and membership. Not a replacement for production auth.
create function public.is_store_manager(s uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from core_auth.sessions ss
join core_auth.users u on u.id=ss.user_id
join core_auth.memberships m on m.user_id=u.id
join core_auth.stores st on st.id=m.store_id
where ss.id=nullif(current_setting('pitacco.core_session_id',true),'')::uuid
and u.id=auth.uid() and ss.revoked_at is null and ss.expires_at>now()
and u.active and m.active and st.active and m.store_id=s and m.role in ('owner','manager'))
$$;
revoke all on function public.is_store_manager(uuid) from public;
grant execute on function public.is_store_manager(uuid) to authenticated;
create table public.orders(id uuid primary key,store_id uuid not null,channel text not null,gross numeric(12,2) not null,status text not null,source text not null,receipt jsonb not null default '{}',preparation_status text,created_at timestamptz not null);
create table public.deliveries(order_id uuid primary key references public.orders,store_id uuid not null,status text);
alter table public.orders enable row level security;
alter table public.deliveries enable row level security;
create policy read_orders on public.orders for select to authenticated using (public.is_store_manager(store_id));
create policy read_deliveries on public.deliveries for select to authenticated using (public.is_store_manager(store_id));
grant select on public.orders,public.deliveries to authenticated;
insert into public.orders values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Delivery próprio',20,'pending','proprio','{}',null,now()),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Delivery próprio',25,'accepted','proprio','{}','preparing',now()-interval '2 days'),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Delivery próprio',30,'cancelled','proprio','{}',null,now()-interval '2 days'),
('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','Delivery próprio',35,'pending','proprio','{}',null,now()),
('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','Delivery próprio',40,'accepted','proprio','{"logistics":"retirada"}','completed',now()-interval '2 days');
