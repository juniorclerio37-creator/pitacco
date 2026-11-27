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

-- Disposable report role: only the original aggregate, no private receipt rows or writes.
create role pitacco_core_financial_read login password 'ci-financial-read-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema public,core_auth,auth to pitacco_core_financial_read;
grant execute on function core_auth.can_act(uuid),auth.uid(),public.pitacco_period_financial_report(uuid,date,date) to pitacco_core_financial_read;
-- Isolated historical fixtures with explicit official receipt records and payment adjustments.
insert into public.orders(id,store_id,channel,gross,fees,created_at,source,status,receipt) values
 ('39000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Delivery próprio',103,0,'2026-11-16T03:00:00Z','proprio','accepted','{"payment_price":{"adjustment_cents":300}}'),
 ('39000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Delivery próprio',95,0,'2026-11-16T04:00:00Z','proprio','accepted','{"payment_price":{"adjustment_cents":-500}}'),
 ('39000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Delivery próprio',99,0,'2026-11-16T02:59:59Z','proprio','accepted','{}'),
 ('39000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Delivery próprio',900,0,'2026-11-16T05:00:00Z','proprio','cancelled','{}'),
 ('39000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002','Delivery próprio',900,0,'2026-11-16T05:00:00Z','proprio','accepted','{}');
insert into public.store_payment_receipts(order_id,store_id,amount,recorded_at) values
 ('39000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',103,'2026-11-16T06:00:00Z'),
 ('39000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002',900,'2026-11-16T06:00:00Z');

-- Test-only scoped configuration reader; no table access granted to the API role.
create function core_auth.payment_settings_fixture(p_store uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('payment_methods',payment_methods,'pdv_payment_methods',coalesce(pdv_payment_methods,payment_methods),'pix_instructions',pix_instructions)
 from public.public_menu_settings where store_id=p_store and core_auth.can_act(p_store)
$$;
revoke all on function core_auth.payment_settings_fixture(uuid) from public,anon,authenticated;
create role pitacco_core_payment_settings login password 'ci-payment-settings-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth,auth,public to pitacco_core_payment_settings;
grant execute on function core_auth.can_act(uuid),auth.uid(),core_auth.payment_settings_fixture(uuid),public.pitacco_save_payment_methods_only(uuid,text[],text[],text) to pitacco_core_payment_settings;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.save_public_menu_settings('20000000-0000-4000-8000-000000000001','core-settings-fixture',true,true,true,0,array['dinheiro'],'');
commit;

-- CI-only merchant draft role. No direct pricing writes and no publication function.
create role pitacco_core_payment_pricing login password 'ci-payment-pricing-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth,auth,public to pitacco_core_payment_pricing;
grant execute on function core_auth.can_act(uuid),auth.uid(),public.pitacco_payment_pricing_drafts(uuid),public.pitacco_payment_pricing_release_status(uuid),public.pitacco_save_payment_pricing_draft(uuid,text,text,integer,integer,bigint) to pitacco_core_payment_pricing;

-- Disposable CI publication role; does not have access to the release switch.
create role pitacco_core_payment_publish login password 'ci-payment-publish-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth,auth,public to pitacco_core_payment_publish;
grant execute on function core_auth.can_act(uuid),auth.uid(),public.pitacco_publish_payment_price(uuid,text,text,bigint) to pitacco_core_payment_publish;

-- Disposable CI only. Explicit scoped wrapper excludes specialized payment flows.
create function core_auth.merchant_checkout_fixture(s uuid,req uuid,mode text,customer text,phone text,items jsonb,payment text,notes text,address text,quote_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 if mode is null or mode not in ('balcao','retirada','entrega') or payment is null or payment not in ('dinheiro','cartao_credito','cartao_debito','cartao_entrega','pix_manual','pix_maquininha','voucher_alelo','voucher_pluxee','voucher_vr','voucher_ticket') then
 raise exception 'Modalidade não suportada' using errcode='22023';end if;
 if mode='entrega' then
  if quote_id is null or not exists(
   select 1 from public.pitacco_delivery_route_quotes q
   join public.pitacco_delivery_pricing p on p.store_id=q.store_id and p.enabled
   where q.id=quote_id and q.store_id=s and q.request_id=req and q.destination_address=trim(address)
  ) then raise exception 'Cotação indisponível' using errcode='22023';end if;
 elsif quote_id is not null or coalesce(trim(address),'')<>'' then
  raise exception 'Cotação exclusiva para entrega' using errcode='22023';
 end if;
 return public.pitacco_merchant_channel_checkout(s,req,mode,customer,phone,coalesce(address,''),items,payment,notes,'',quote_id,null,null);
end $$;
revoke all on function core_auth.merchant_checkout_fixture(uuid,uuid,text,text,text,jsonb,text,text,text,uuid) from public,anon,authenticated;
create role pitacco_core_merchant_checkout login password 'ci-merchant-checkout-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth,auth to pitacco_core_merchant_checkout;
grant execute on function core_auth.can_act(uuid),auth.uid(),core_auth.merchant_checkout_fixture(uuid,uuid,text,text,text,jsonb,text,text,text,uuid) to pitacco_core_merchant_checkout;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.pitacco_store_hours_save_v2('20000000-0000-4000-8000-000000000001',(select jsonb_agg(jsonb_build_object('weekday',day,'slot',1,'opens_minute',0,'closes_minute',1440)) from generate_series(1,7) day),false,0,true);
commit;

-- Synthetic route pricing, never a production geocoder or routing response.
update public.stores set latitude=-22.91,longitude=-43.46,address='Rua Fixture',city='Nova Iguaçu',state='RJ'
where id='20000000-0000-4000-8000-000000000001';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.pitacco_save_delivery_zone_times('20000000-0000-4000-8000-000000000001',1,'[5,5,5,5,5,5,5,5,5,5]',(select jsonb_agg('{"min_minutes":40,"max_minutes":60,"priority":{"enabled":true,"fee":9,"min_minutes":20,"max_minutes":30}}'::jsonb) from generate_series(1,10)));
commit;
