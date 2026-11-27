-- ONLY after the full legacy regression harness, in disposable PostgreSQL.
-- Test-only schema and identity bridge; not a migration or production ACL.
create role pitacco_core_actions login password 'ci-actions-only' nosuperuser nocreatedb nocreaterole nobypassrls;
create function core_auth.can_act(s uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from core_auth.sessions ss
join core_auth.users u on u.id=ss.user_id
join core_auth.memberships m on m.user_id=u.id
join core_auth.stores st on st.id=m.store_id
where ss.id=nullif(current_setting('pitacco.core_session_id',true),'')::uuid
and u.id=auth.uid() and ss.revoked_at is null and ss.expires_at>now()
and u.active and m.active and st.active and m.store_id=s and m.role in ('owner','manager'))
and public.is_store_manager(s)
$$;
revoke all on function core_auth.can_act(uuid) from public;
grant usage on schema core_auth,auth to pitacco_core_actions;
grant execute on function core_auth.can_act(uuid),auth.uid() to pitacco_core_actions;
-- The existing legacy functions remain unchanged. Restrict this fixture role to explicit operations.
revoke execute on all functions in schema public from public;
grant execute on function public.accept_order(uuid),public.set_order_preparation(uuid,text),public.pitacco_decide_pending_order(uuid,text,text) to pitacco_core_actions;
grant select(id,store_id,source,status,preparation_status) on public.orders to pitacco_core_actions;
create policy core_actions_read on public.orders for select to pitacco_core_actions using (core_auth.can_act(store_id));
-- Synthetic accounts mirrored to the legacy identity schema. No password migration.
insert into auth.users(id,email,email_confirmed_at) values
('10000000-0000-4000-8000-000000000001','alice@example.test',now()),
('10000000-0000-4000-8000-000000000002','bob@example.test',now());
insert into auth.sessions(id,user_id) values
('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002') on conflict do nothing;
insert into public.stores(id,name,dispatch_mode) values
('20000000-0000-4000-8000-000000000001','Loja A','manual'),
('20000000-0000-4000-8000-000000000002','Loja B','manual');
insert into public.store_members(store_id,user_id,role) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','gestor'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','gestor');
-- Commercial gates have their own full regression suite above. This fixture tests transitions.
update pitacco_private.commercial_billing_control set require_selected_plan=false,enforce_own_orders=false where singleton;
insert into public.print_sectors(store_id,sector,printer,width,copies) values
('20000000-0000-4000-8000-000000000001','cozinha','TEST-58',58,2);
insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Delivery próprio',20,'proprio','pending','preparing','{"logistics":"retirada","customer":"Cliente fixture","items":[{"name":"Açaí","quantity":1,"unit_price":20,"modifiers":[]}],"total":20,"payment":"dinheiro","payment_status":"nao confirmado"}'),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Delivery próprio',20,'proprio','pending','preparing','{"logistics":"retirada"}'),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','Delivery próprio',20,'proprio','pending','preparing','{"logistics":"retirada"}'),
('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','iFood',20,'ifood','pending','preparing','{}'),
('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','Delivery próprio',20,'proprio','accepted','preparing','{"logistics":"loja"}');

-- Synthetic administrative read role; existing manager and session checks stay mandatory.
create role pitacco_core_fiado_read login password 'ci-fiado-read-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth,auth,public to pitacco_core_fiado_read;
grant execute on function core_auth.can_act(uuid),auth.uid(),public.pitacco_fiado_overview(uuid) to pitacco_core_fiado_read;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.pitacco_fiado_toggle('20000000-0000-4000-8000-000000000001',true);
select public.pitacco_fiado_save_customer('20000000-0000-4000-8000-000000000001','Conta fictícia A','21988881110',100,true,7,'manual',true);
commit;

-- Separate permission for manager configuration, no direct table access.
create role pitacco_core_fiado_manage login password 'ci-fiado-manage-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth,auth,public to pitacco_core_fiado_manage;
grant execute on function core_auth.can_act(uuid),auth.uid(),public.pitacco_fiado_toggle(uuid,boolean),public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) to pitacco_core_fiado_manage;

-- Additional explicit manager-only operations and a synthetic PDV product.
grant execute on function public.pitacco_fiado_approve(uuid,uuid,boolean),public.pitacco_fiado_receive(uuid,uuid,numeric,text,uuid,text) to pitacco_core_fiado_manage;
insert into public.products(id,store_id,name,price,cost,menu_active)
values('31000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Produto Fiado Fixture',20,5,true);
