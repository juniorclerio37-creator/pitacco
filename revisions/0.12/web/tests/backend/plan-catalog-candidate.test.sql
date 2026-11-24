insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','catalog-owner@example.invalid'),('10000000-0000-0000-0000-000000000002','catalog-manager@example.invalid'),('10000000-0000-0000-0000-000000000003','catalog-outsider@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash) values('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
insert into public.stores(id,name) values('20000000-0000-0000-0000-000000000001','Catálogo loja');
insert into public.store_members values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare c jsonb; v jsonb; begin
 c:=public.pitacco_owner_plan_catalog();
 assert c#>>'{plans,1,monthly_cents}'='5990';
 v:=public.pitacco_owner_publish_plan_catalog(c->>'terms_version',jsonb_set(jsonb_set(jsonb_set(jsonb_set(c->'plans','{1,monthly_cents}','6990'),'{1,name}','"Completo Plus"'),'{1,description}','"Oferta revisada"'),'{0,available}','false'));
 assert v#>>'{plans,1,monthly_cents}'='6990';
 assert jsonb_array_length(public.pitacco_owner_plan_catalog_history())=2;
 begin perform public.pitacco_owner_publish_plan_catalog(c->>'terms_version',c->'plans');raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ declare c jsonb; rid uuid; begin
 c:=public.pitacco_merchant_plan_options('20000000-0000-0000-0000-000000000001');
 assert c#>>'{plans,1,monthly_cents}'='6990' and c#>>'{plans,1,name}'='Completo Plus';
 assert c#>>'{plans,1,description}'='Oferta revisada' and c#>>'{plans,0,available}'='false';
 begin perform public.pitacco_owner_plan_catalog_history();raise exception 'Unauthorized history';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_request_plan_change('20000000-0000-0000-0000-000000000001','free',c->>'terms_version');raise exception 'Disabled offer accepted';exception when invalid_parameter_value then null;end;
 begin perform public.pitacco_owner_plan_catalog();raise exception 'Unauthorized read';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_owner_publish_plan_catalog(c->>'terms_version',c->'plans');raise exception 'Unauthorized write';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_request_plan_change('20000000-0000-0000-0000-000000000001','complete','2026-11-24-v1');raise exception 'Stale terms accepted';exception when invalid_parameter_value then null;end;
 rid:=public.pitacco_request_plan_change('20000000-0000-0000-0000-000000000001','complete',c->>'terms_version');assert rid is not null;
 c:=public.pitacco_merchant_plan_options('20000000-0000-0000-0000-000000000001');assert c#>>'{requests,0,plan_name}'='Completo Plus';
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ begin
 begin perform public.pitacco_merchant_plan_options('20000000-0000-0000-0000-000000000001');raise exception 'Cross-store access accepted';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $catalog$ declare c jsonb; v jsonb; begin
 c:=public.pitacco_owner_plan_catalog();
 assert public.pitacco_owner_plan_requests()#>>'{0,accepted_offer,monthly_cents}'='6990';
 v:=public.pitacco_owner_publish_plan_catalog(c->>'terms_version',c->'plans'||'[{"code":"premium","name":"Premium","monthly_cents":9990,"commission_basis_points":100,"billing_cycle":"weekly","trial_days":7,"available":true}]'::jsonb);
 assert jsonb_array_length(v->'plans')=3;
 assert v#>>'{plans,2,billing_cycle}'='weekly';
end $catalog$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $catalog$ declare c jsonb; rid uuid; begin
 c:=public.pitacco_merchant_plan_options('20000000-0000-0000-0000-000000000001');
 assert c#>>'{plans,2,name}'='Premium';
 perform public.pitacco_cancel_plan_change('20000000-0000-0000-0000-000000000001',(c#>>'{requests,0,id}')::uuid);
 rid:=public.pitacco_request_plan_change('20000000-0000-0000-0000-000000000001','premium',c->>'terms_version');
 assert rid is not null;
end $catalog$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $growth$ declare g jsonb; begin
 g:=public.pitacco_owner_growth(3);
 assert jsonb_array_length(g->'months')=3;
 assert (g#>>'{months,2,new_stores}')::int>=1;
 begin perform public.pitacco_owner_growth(13);raise exception 'Invalid period accepted';exception when invalid_parameter_value then null;end;
end $growth$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $growth$ begin
 begin perform public.pitacco_owner_growth(3);raise exception 'Unauthorized growth';exception when insufficient_privilege then null;end;
end $growth$;
reset role;
insert into public.loyalty_coupons(id,store_id,code,discount_type,discount_value) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','ADMINTEST','percent',10);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $extended$ declare r jsonb; begin
 r:=public.pitacco_owner_store_members('20000000-0000-0000-0000-000000000001');assert jsonb_array_length(r->'rows')=1;
 r:=public.pitacco_owner_campaign_rows('20000000-0000-0000-0000-000000000001');assert r#>>'{rows,0,code}'='ADMINTEST';
 perform public.pitacco_owner_campaign_active('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',false);
 assert public.pitacco_owner_campaign_rows('20000000-0000-0000-0000-000000000001')#>>'{rows,0,active}'='false';
 assert jsonb_typeof(public.pitacco_owner_live_positions()->'rows')='array';
 assert public.pitacco_owner_general_settings() ? 'enforce_new_orders';
end $extended$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $extended$ begin
 begin perform public.pitacco_owner_live_positions();raise exception 'Unauthorized fleet';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_owner_store_members('20000000-0000-0000-0000-000000000001');raise exception 'Unauthorized members';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_owner_campaign_active('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',true);raise exception 'Unauthorized campaign';exception when insufficient_privilege then null;end;
end $extended$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $role_test$ begin
 begin perform public.pitacco_owner_set_store_member_role('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','lojista');raise exception 'Last manager removed';exception when invalid_parameter_value then null;end;
 begin perform public.pitacco_owner_set_store_member_role('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','admin');raise exception 'Admin escalation';exception when invalid_parameter_value then null;end;
end $role_test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $role_test$ begin
 begin perform public.pitacco_owner_set_store_member_role('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');raise exception 'Unauthorized role change';exception when insufficient_privilege then null;end;
end $role_test$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $amount$ declare r jsonb; begin
 r:=public.pitacco_owner_subscription_details();
 assert exists(select 1 from jsonb_array_elements(r) p where p->>'id'='20000000-0000-0000-0000-000000000001' and p->>'plan' is not null and p->'monthly_amount'='null'::jsonb);
 assert public.pitacco_subscription_overview() ? 'active_without_registered_amount';
end $amount$;
reset role;
do $base_test$ begin
 assert pitacco_private.commission_product_base('{"subtotal":100,"discount":10,"delivery_fee":8,"tip":5}')=9000;
 assert pitacco_private.commission_product_base('{"subtotal":100,"discount":10,"refund":5}') is null;
 assert pitacco_private.commission_product_base('{"total":100}') is null;
 assert pitacco_private.commission_product_base('{"subtotal":10,"discount":11}') is null;
end $base_test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $amount_test$ begin
 assert public.pitacco_commercial_amount_preview('20000000-0000-0000-0000-000000000001')->>'status'='unassigned';
end $amount_test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $amount_test$ declare req uuid; cid uuid; result jsonb; begin
 select (p->>'id')::uuid into req from jsonb_array_elements(public.pitacco_owner_plan_requests()) p where p->>'requested_plan'='premium';
 cid:=public.pitacco_owner_schedule_commercial_contract(req,(now() at time zone 'America/Sao_Paulo')::date,'Condições aceitas para teste isolado');
 assert cid is not null;
 result:=public.pitacco_commercial_amount_preview('20000000-0000-0000-0000-000000000001');
 assert result->>'plan_name'='Premium' and result->>'status'='trial' and result->>'commission_cents'='0';
end $amount_test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $amount_test$ begin
 begin perform public.pitacco_commercial_amount_preview('20000000-0000-0000-0000-000000000001');raise exception 'Cross-store billing';exception when insufficient_privilege then null;end;
end $amount_test$;
reset role;

-- A previous closed Wednesday cycle, calculated only in this rolled-back fixture.
insert into public.stores(id,name) values('20000000-0000-0000-0000-000000000002','Loja comissão');
insert into public.store_members values('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','gestor');
insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by)
select '20000000-0000-0000-0000-000000000002',revision,'free',date '2026-11-04',plans->0,'10000000-0000-0000-0000-000000000001'
from pitacco_private.plan_catalog_versions where revision='2026-11-24-v1';
insert into public.orders(id,store_id,channel,gross,status,source,preparation_status,created_at,receipt) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Delivery próprio',98,'accepted','proprio','completed','2026-11-05 12:00+00','{"subtotal":100,"discount":10,"delivery_fee":8}'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','iFood',100,'accepted','ifood','completed','2026-11-05 12:00+00','{"subtotal":100,"discount":0}'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','Delivery próprio',50,'cancelled','proprio','completed','2026-11-05 12:00+00','{"subtotal":50,"discount":0}');
do $closing_test$ declare a integer; b integer; begin
 perform pitacco_private.refresh_commercial_closings();
 select count(*) into a from pitacco_private.commercial_closings;
 perform pitacco_private.refresh_commercial_closings();
 select count(*) into b from pitacco_private.commercial_closings;
 assert a=b and a>0;
 assert exists(select 1 from pitacco_private.commercial_closings where store_id='20000000-0000-0000-0000-000000000002' and period_end='2026-11-11' and kind='commission' and amount_cents=450 and state='calculated' and grace_until=due_at+interval '48 hours');
end $closing_test$;
update public.orders set receipt=receipt||'{"refund":5}'::jsonb where id='30000000-0000-0000-0000-000000000001';
select pitacco_private.refresh_commercial_closings();
do $closing_test$ begin
 assert exists(select 1 from pitacco_private.commercial_closings where store_id='20000000-0000-0000-0000-000000000002' and period_end='2026-11-11' and amount_cents is null and state='review_required');
end $closing_test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $closing_test$ begin
 assert jsonb_array_length(public.pitacco_commercial_closings('20000000-0000-0000-0000-000000000002')->'rows')>0;
 begin perform public.pitacco_owner_refresh_commercial_closings();raise exception 'Unauthorized closing';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_commercial_closings(null);raise exception 'Unauthorized global closing';exception when insufficient_privilege then null;end;
end $closing_test$;
reset role;

do $anniversary_test$ begin
 assert pitacco_private.monthly_due_on_or_after(date '2026-01-31',date '2026-02-01')=date '2026-02-28';
 assert pitacco_private.monthly_due_on_or_after(date '2026-01-31',date '2026-03-01')=date '2026-03-31';
 assert pitacco_private.monthly_due_on_or_after(date '2028-01-31',date '2028-02-01')=date '2028-02-29';
 assert pitacco_private.monthly_due_on_or_after(date '2026-11-24'+30,date '2026-12-01')=date '2026-12-24';
 assert pitacco_private.monthly_due_on_or_after(date '2026-11-24'+30,date '2027-01-01')=date '2027-01-24';
end $anniversary_test$;
-- First monthly fee must fall on registration + 30 days, not a second month after the trial.
insert into public.stores(id,name,created_at) values('20000000-0000-0000-0000-000000000003','Loja mensal','2026-09-01 12:00+00');
insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by)
select '20000000-0000-0000-0000-000000000003',revision,'complete',date '2026-09-01',plans->1,'10000000-0000-0000-0000-000000000001'
from pitacco_private.plan_catalog_versions where revision='2026-11-24-v1';
do $anniversary_test$ declare r jsonb; begin
 r:=pitacco_private.commercial_amount_calculate('20000000-0000-0000-0000-000000000003','2026-09-30');
 assert r->>'first_monthly_due'='2026-10-01';
 assert r->>'monthly_period_end_exclusive'='2026-10-01';
 assert r->>'monthly_cents'='5990';
 perform pitacco_private.refresh_commercial_closings();
 assert exists(select 1 from pitacco_private.commercial_closings where store_id='20000000-0000-0000-0000-000000000003' and kind='monthly' and period_end='2026-10-01' and amount_cents=5990);
 assert exists(select 1 from pitacco_private.commercial_closings where store_id='20000000-0000-0000-0000-000000000003' and kind='monthly' and period_end='2026-11-01' and amount_cents=5990);
end $anniversary_test$;
