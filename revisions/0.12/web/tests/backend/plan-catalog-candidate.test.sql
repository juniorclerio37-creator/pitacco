insert into auth.users(id,email) values ('10000000-0000-0000-0000-000000000001','catalog-owner@example.invalid'),('10000000-0000-0000-0000-000000000002','catalog-manager@example.invalid'),('10000000-0000-0000-0000-000000000003','catalog-outsider@example.invalid');
insert into pitacco_private.platform_owner(user_id,login_name_hash) values('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
insert into public.stores(id,name) values('20000000-0000-0000-0000-000000000001','Catálogo loja');
insert into public.store_members values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare c jsonb; v jsonb; begin
 c:=public.pitacco_owner_plan_catalog();
 assert c#>>'{plans,1,monthly_cents}'='5990';
 v:=public.pitacco_owner_publish_plan_catalog(c->>'terms_version',jsonb_set(jsonb_set(c->'plans','{1,monthly_cents}','6990'),'{1,name}','"Completo Plus"'));
 assert v#>>'{plans,1,monthly_cents}'='6990';
 begin perform public.pitacco_owner_publish_plan_catalog(c->>'terms_version',c->'plans');raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ declare c jsonb; rid uuid; begin
 c:=public.pitacco_merchant_plan_options('20000000-0000-0000-0000-000000000001');
 assert c#>>'{plans,1,monthly_cents}'='6990' and c#>>'{plans,1,name}'='Completo Plus';
 begin perform public.pitacco_owner_plan_catalog();raise exception 'Unauthorized read';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_owner_publish_plan_catalog(c->>'terms_version',c->'plans');raise exception 'Unauthorized write';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_request_plan_change('20000000-0000-0000-0000-000000000001','complete','2026-11-24-v1');raise exception 'Stale terms accepted';exception when invalid_parameter_value then null;end;
 rid:=public.pitacco_request_plan_change('20000000-0000-0000-0000-000000000001','complete',c->>'terms_version');assert rid is not null;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ begin
 begin perform public.pitacco_merchant_plan_options('20000000-0000-0000-0000-000000000001');raise exception 'Cross-store access accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
