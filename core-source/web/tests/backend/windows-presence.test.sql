begin;
insert into auth.users(id,email) values
 ('b1000000-0000-0000-0000-000000000001','windows-owner@example.invalid'),
 ('b1000000-0000-0000-0000-000000000002','windows-other@example.invalid');
insert into public.stores(id,name) values
 ('b2000000-0000-0000-0000-000000000001','Loja Windows A'),
 ('b2000000-0000-0000-0000-000000000002','Loja Windows B');
insert into public.store_members(store_id,user_id,role) values
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','gestor'),
 ('b2000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
do $test$
declare result jsonb;
begin
 result:=public.pitacco_windows_connection('b2000000-0000-0000-0000-000000000001');
 assert result->>'status'='not_detected';
 assert result->>'installation_confirmed'='false';
 assert result->>'automatic_print_tested'='false';
 perform public.pitacco_windows_ping('b2000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001');
 result:=public.pitacco_windows_connection('b2000000-0000-0000-0000-000000000001');
 assert result->>'status'='connected';
 assert result->>'app_logged_in_now'='true';
 assert result->>'printer_computer_bound'='false';
 begin
  perform public.pitacco_windows_ping('b2000000-0000-0000-0000-000000000002','b3000000-0000-0000-0000-000000000001');
  raise exception 'Cross-tenant ping must be denied';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_windows_connection('b2000000-0000-0000-0000-000000000002');
  raise exception 'Cross-tenant presence must be denied';
 exception when insufficient_privilege then null;end;
end $test$;
reset role;
insert into public.print_devices(store_id,device_id,bound_by,bound_at)
values('b2000000-0000-0000-0000-000000000001',
'b3000000-0000-0000-0000-000000000001',
'b1000000-0000-0000-0000-000000000001',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
do $test$
declare result jsonb;
begin
 result:=public.pitacco_windows_connection('b2000000-0000-0000-0000-000000000001');
 assert result->>'bound_computer_connected'='true';
end $test$;
reset role;
update public.pitacco_windows_presence set last_seen_at=now()-interval '5 minutes'
where store_id='b2000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
do $test$
declare result jsonb;
begin
 result:=public.pitacco_windows_connection('b2000000-0000-0000-0000-000000000001');
 assert result->>'status'='offline';
 assert result->>'app_logged_in_now'='false';
 assert result->>'printer_computer_bound'='true';
end $test$;
reset role;
do $test$
begin
 assert not has_table_privilege('authenticated','public.pitacco_windows_presence','SELECT');
 assert not has_table_privilege('authenticated','public.pitacco_windows_presence','INSERT');
 assert not has_function_privilege('anon','public.pitacco_windows_ping(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_windows_connection(uuid)','EXECUTE');
end $test$;
rollback;
