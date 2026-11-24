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
