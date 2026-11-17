begin;
insert into auth.users(id,email) values
 ('a1000000-0000-0000-0000-000000000001','launch-manager@example.invalid'),
 ('a1000000-0000-0000-0000-000000000002','launch-other@example.invalid');
insert into public.stores(id,name,address,city,state) values
 ('a2000000-0000-0000-0000-000000000001','Loja Nova','Rua do Teste','Nova Iguacu','RJ'),
 ('a2000000-0000-0000-0000-000000000002','Loja B','Rua B','Belford Roxo','RJ');
insert into public.store_members values
 ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','gestor'),
 ('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','gestor');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
do $test$
declare summary jsonb;
begin
 summary:=public.pitacco_store_launch_diagnostic('a2000000-0000-0000-0000-000000000001');
 assert summary->>'configured'='false';
 assert summary->'checks'->>'products'='action';
 assert summary->'checks'->>'print_on_paper'='manual';
 assert summary->>'fully_homologated'='false';
 begin
  perform public.pitacco_store_launch_diagnostic('a2000000-0000-0000-0000-000000000002');
  raise exception 'Cross-tenant launch verification must fail';
 exception when insufficient_privilege then null;end;
end $test$;

reset role;
insert into public.products(id,store_id,name,price,cost,menu_active)
 values('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001',
 'Açaí 500 ml',25,6,true);

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
select public.save_public_menu_settings(
 'a2000000-0000-0000-0000-000000000001','lojatesteinicio',true,true,true,5,
 array['dinheiro'],'');
do $test$
declare summary jsonb; report jsonb; history jsonb;
begin
 summary:=public.pitacco_store_launch_diagnostic('a2000000-0000-0000-0000-000000000001');
 assert summary->'checks'->>'identity'='ok';
 assert summary->'checks'->>'address'='ok';
 assert summary->'checks'->>'products'='ok';
 assert summary->'checks'->>'catalog_link'='ok';
 assert summary->'checks'->>'catalog_live'='ok';
 assert summary->'checks'->>'checkout_configuration'='ok';
 assert summary->>'configured'='true';
 assert summary->>'fully_homologated'='false';
 report:=public.pitacco_store_run_preflight('a2000000-0000-0000-0000-000000000001');
 assert report ? 'run_id';
 assert report->>'run_type'='read_only_diagnostic';
 assert report->'checks'->>'print_on_paper'='manual';
 history:=public.pitacco_store_preflight_history('a2000000-0000-0000-0000-000000000001');
 assert jsonb_array_length(history)=1;
 begin
  perform public.pitacco_store_run_preflight('a2000000-0000-0000-0000-000000000002');
  raise exception 'Cross-tenant run must fail';
 exception when insufficient_privilege then null;end;
end $test$;
select set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000002',true);
do $test$
begin
 assert jsonb_array_length(public.pitacco_store_preflight_history('a2000000-0000-0000-0000-000000000002'))=0;
 begin
  perform public.pitacco_store_preflight_history('a2000000-0000-0000-0000-000000000001');
  raise exception 'History across tenants must fail';
 exception when insufficient_privilege then null;end;
end $test$;
reset role;
do $test$
begin
 assert not has_table_privilege('authenticated','public.pitacco_store_preflight_runs','SELECT');
 assert not has_table_privilege('authenticated','public.pitacco_store_preflight_runs','INSERT');
 assert not has_function_privilege('anon','public.pitacco_store_launch_diagnostic(uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_store_run_preflight(uuid)','EXECUTE');
end $test$;
rollback;
