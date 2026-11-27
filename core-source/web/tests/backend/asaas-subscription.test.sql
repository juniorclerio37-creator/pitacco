begin;
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000001','Asaas Test Store');
update pitacco_private.subscription_control set asaas_environment='sandbox';
insert into pitacco_private.asaas_subscription_bindings(environment,subscription_id,store_id)
 values ('sandbox','sub_bound','20000000-0000-0000-0000-000000000001');

do $test$
begin
 assert not has_function_privilege('authenticated','public.pitacco_record_asaas_subscription_payment(text,text,text,numeric)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_record_asaas_subscription_payment(text,text,text,numeric)','EXECUTE');
end;
$test$;

set local role service_role;
do $test$
declare coverage timestamptz;
begin
 assert public.pitacco_record_asaas_subscription_payment('sandbox','sub_unrelated','pay_1',59.90) is null;
 begin
  perform public.pitacco_record_asaas_subscription_payment('production','sub_bound','pay_1',59.90);
  raise exception 'Expected sandbox and production to be distinct';
 exception when raise_exception then
  if sqlerrm <> 'Ambiente do Asaas ainda não habilitado' then raise; end if;
 end;
 coverage:=public.pitacco_record_asaas_subscription_payment('sandbox','sub_bound','pay_1',59.90);
 assert coverage>now();
 assert public.pitacco_record_asaas_subscription_payment('sandbox','sub_bound','pay_1',59.90)=coverage, 'Provider replay is safe';
end;
$test$;
reset role;
do $test$
begin
 assert (select count(*) from pitacco_private.subscription_payments)=1;
end;
$test$;
rollback;
