begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000081','insights-manager@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000082','insights-other@example.invalid',now());
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000081','Loja insights'),('20000000-0000-0000-0000-000000000082','Outra insights');
insert into public.store_members values ('20000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000081','gestor');
insert into public.pitacco_ingredients(store_id,name,unit,minimum) values ('20000000-0000-0000-0000-000000000081','Açaí teste','g',100),('20000000-0000-0000-0000-000000000082','Insumo privado','g',100);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000081',true);
do $test$
declare d jsonb;
begin
 d:=public.pitacco_business_insights('20000000-0000-0000-0000-000000000081');
 assert d#>>'{sales,orders}'='0';
 assert d#>'{sales,known_contribution}'='null'::jsonb;
 assert jsonb_array_length(d->'weekdays')=7;
 assert jsonb_array_length(d->'stock_alerts')=1;
 assert d#>>'{stock_alerts,0,name}'='Açaí teste';
 assert d#>'{stock_alerts,0,days_left}'='null'::jsonb;
 begin perform public.pitacco_business_insights('20000000-0000-0000-0000-000000000082');raise exception 'Cross-store access accepted';exception when insufficient_privilege then null;end;
end $test$;
reset role;
rollback;
