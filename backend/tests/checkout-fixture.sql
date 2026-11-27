-- Disposable CI only: original functions already rebuilt by legacy regression runner.
create role pitacco_core_checkout login password 'ci-checkout-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema public to pitacco_core_checkout;
revoke execute on all functions in schema public from public;
grant execute on function public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text),public.pitacco_checkout_scheduled_order(text,uuid,text,text,text,jsonb,text,text,text,timestamptz),public.pitacco_checkout_quoted_delivery(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz),public.pitacco_delivery_quote_point(uuid,uuid,text),public.pitacco_public_checkout_recovery(text,uuid),public.pitacco_confirm_priced_public_checkout(text,uuid,text,text,text,jsonb,text,text,text,bigint,bigint,text,text,text,uuid,timestamptz,boolean) to pitacco_core_checkout;
insert into auth.users(id,email) values('91000000-0000-0000-0000-000000000001','checkout-core@example.invalid');
insert into public.stores(id,name,dispatch_mode,latitude,longitude,address,city,state) values('91000000-0000-0000-0000-000000000002','Checkout Core fixture','manual',-22.91,-43.46,'Rua Fixture','Nova Iguaçu','RJ');
insert into public.store_members values('91000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','gestor');
insert into public.products(id,store_id,name,price,cost,menu_active) values('91000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000002','Fixture',25,8,true);
update pitacco_private.commercial_billing_control set require_selected_plan=false,enforce_own_orders=false where singleton;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings('91000000-0000-0000-0000-000000000002','core-checkout-fixture',true,true,true,0,array['pix_manual'],'Chave Pix fixture');
select public.pitacco_store_hours_save_v2('91000000-0000-0000-0000-000000000002',(select jsonb_agg(jsonb_build_object('weekday',day,'slot',1,'opens_minute',0,'closes_minute',1440)) from generate_series(1,7) day),false,0,true);
select public.pitacco_save_delivery_zone_times('91000000-0000-0000-0000-000000000002',1,'[5,5,5,5,5,5,5,5,5,5]',(select jsonb_agg('{"min_minutes":40,"max_minutes":60,"priority":{"enabled":true,"fee":9,"min_minutes":20,"max_minutes":30}}'::jsonb) from generate_series(1,10)));
commit;
insert into public.acceptance_settings(store_id,source,mode,enabled) values('91000000-0000-0000-0000-000000000002','proprio','automatic',true);
insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,delivery_min_minutes,delivery_max_minutes,delivery_region,delivery_service)
select '91000000-0000-0000-0000-000000000011',store_id,'92000000-0000-0000-0000-000000000011','Rua Fixture 123',500,9,updated_at,now()+interval '10 minutes',-22.91,-43.46,20,30,'Centro','priority'
from public.pitacco_delivery_pricing where store_id='91000000-0000-0000-0000-000000000002';

-- Synthetic Fideliza fixtures.
grant execute on function public.pitacco_loyalty_checkout(text,uuid,text,text,text,jsonb,text,text,text,text,text,text,uuid,timestamptz,text) to pitacco_core_checkout;
insert into public.loyalty_programs(store_id,points_enabled,points_per_real,min_points_to_redeem,points_reward_cents,orders_enabled,orders_required,orders_reward_cents,cashback_enabled,cashback_percent,cashback_max_redeem_percent,referrals_enabled,referral_reward_cents,referral_welcome_cents,campaigns_enabled)
values('91000000-0000-0000-0000-000000000002',true,1,100,1000,true,1,500,true,10,100,true,300,200,true);
insert into public.loyalty_coupons(store_id,code,discount_type,discount_value,max_uses,starts_at) values('91000000-0000-0000-0000-000000000002','CORE20','percent',20,1,now()-interval '1 day');

-- Separate synthetic tracking role; no direct table or checkout grants.
create role pitacco_core_tracking login password 'ci-tracking-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema public to pitacco_core_tracking;
grant execute on function public.pitacco_track_public_order(uuid) to pitacco_core_tracking;

-- Read-only menu role in the disposable reconstructed database.
create role pitacco_core_menu login password 'ci-menu-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema public to pitacco_core_menu;
grant execute on function public.get_public_menu(text) to pitacco_core_menu;

-- Isolated synthetic profile permission; no direct reads of personal data.
create role pitacco_core_profile login password 'ci-profile-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema public to pitacco_core_profile;
grant execute on function public.pitacco_v2_customer_profile(text,text,text,text,text,jsonb) to pitacco_core_profile;

grant execute on function public.pitacco_customer_device_session(text,text,text) to pitacco_core_profile;

-- Original device-bound history function; no direct table access.
grant execute on function public.pitacco_customer_device_orders(text,text,text,uuid) to pitacco_core_profile;
