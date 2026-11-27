begin;
do $test$ declare s uuid; owner_id uuid:=gen_random_uuid(); x jsonb; begin
 insert into auth.users(id,email) values(owner_id,owner_id::text||'@example.invalid');
 insert into pitacco_private.platform_owner(user_id,login_name_hash) values(owner_id,sha256(convert_to('fixture-payer-owner','UTF8'))) on conflict(singleton) do update set user_id=excluded.user_id,login_name_hash=excluded.login_name_hash;
 update pitacco_private.subscription_control set asaas_environment='production';
 insert into public.stores(name) values('Fixture legacy fiscal') returning id into s;
 begin perform public.pitacco_asaas_prepare_owner_customer(gen_random_uuid(),s,'52998224725');raise exception 'TEST unauthorized';exception when insufficient_privilege then null;end;
 x:=public.pitacco_asaas_prepare_owner_customer(owner_id,s,'52998224725');
 assert (x->>'allow_create')::boolean;
 assert (select document_last4='4725' from pitacco_private.commercial_fiscal_identity where store_id=s);
 assert not (public.pitacco_asaas_prepare_owner_customer(owner_id,s,'52998224725')->>'allow_create')::boolean;
 assert not has_function_privilege('authenticated','public.pitacco_asaas_prepare_owner_customer(uuid,uuid,text)','execute');
end $test$;
rollback;