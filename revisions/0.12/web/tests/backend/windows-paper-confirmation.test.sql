begin;
insert into auth.users(id,email) values
 ('c1000000-0000-0000-0000-000000000001','print-windows-manager@example.invalid'),
 ('c1000000-0000-0000-0000-000000000002','print-windows-other@example.invalid');
insert into public.stores(id,name) values
 ('c2000000-0000-0000-0000-000000000001','Windows Printer A'),
 ('c2000000-0000-0000-0000-000000000002','Windows Printer B');
insert into public.store_members(store_id,user_id,role) values
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','gestor'),
 ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
do $test$
declare result jsonb; check_id uuid; summary jsonb;
begin
 begin
  perform public.pitacco_windows_print_check_started(
   'c2000000-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000001','Cozinha',80);
  raise exception 'Expected a recent authenticated Windows connection';
 exception when raise_exception then
  if sqlerrm <> 'O aplicativo Windows precisa estar conectado para registrar o teste' then raise;end if;
 end;
 perform public.pitacco_windows_ping(
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001');
 result:=public.pitacco_windows_print_check_started(
  'c2000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-000000000001','Cozinha 80mm',80);
 check_id:=(result->>'test_id')::uuid;
 assert result->>'state'='awaiting_confirmation';
 summary:=public.pitacco_windows_connection('c2000000-0000-0000-0000-000000000001');
 assert summary->'last_printer_test'->>'outcome'='awaiting_confirmation';
 assert summary->>'automatic_print_tested'='false';
 begin
  perform public.pitacco_windows_print_check_started(
   'c2000000-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000001','Cozinha',40);
  raise exception 'Invalid paper width must fail';
 exception when raise_exception then
  if sqlerrm <> 'Impressora ou papel inválido' then raise;end if;
 end;
 begin
  perform public.pitacco_windows_print_check_started(
   'c2000000-0000-0000-0000-000000000002',
   'c3000000-0000-0000-0000-000000000001','Cozinha',80);
  raise exception 'Cross-store test must fail';
 exception when insufficient_privilege then null;end;
 result:=public.pitacco_windows_print_check_confirm(
  'c2000000-0000-0000-0000-000000000001',check_id,'printed');
 assert result->>'confirmed'='true';
 summary:=public.pitacco_windows_connection('c2000000-0000-0000-0000-000000000001');
 assert summary->'last_printer_test'->>'outcome'='printed';
 assert summary->'last_printer_test'->>'verified_by_operator'='true';
 assert summary->>'automatic_print_tested'='false';
 begin
  perform public.pitacco_windows_print_check_confirm(
    'c2000000-0000-0000-0000-000000000001',check_id,'printed');
  raise exception 'Duplicate confirmations must fail';
 exception when raise_exception then
  if sqlerrm <> 'Este teste já foi confirmado' then raise;end if;
 end;
end $test$;
reset role;
do $test$
begin
 assert not has_table_privilege('authenticated','public.pitacco_windows_print_checks','SELECT');
 assert not has_table_privilege('authenticated','public.pitacco_windows_print_checks','INSERT');
 assert not has_function_privilege('anon','public.pitacco_windows_print_check_started(uuid,uuid,text,integer)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_windows_print_check_confirm(uuid,uuid,text)','EXECUTE');
end $test$;
rollback;
