begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000001','owner@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000002','other@example.invalid',now());
update public.profiles set role='admin';
insert into pitacco_private.platform_owner(user_id,login_name_hash)
values ('10000000-0000-0000-0000-000000000001',sha256(convert_to('00000000001','UTF8')));
set local role service_role;
do $test$
begin
 assert public.pitacco_lookup_platform_owner_login(encode(sha256(convert_to('00000000001','UTF8')),'hex'))='owner@example.invalid';
 assert public.pitacco_lookup_platform_owner_login(encode(sha256(convert_to('00000000002','UTF8')),'hex')) is null;
 assert public.pitacco_lookup_platform_owner_login('invalid') is null;
end;
$test$;
reset role;
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Loja A'),
 ('20000000-0000-0000-0000-000000000002','Loja B');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare
 store_b uuid:='20000000-0000-0000-0000-000000000002';
 product_id uuid;
 group_id uuid;
 option_id uuid;
 placed jsonb;
begin
 assert public.is_admin();
 assert public.pitacco_is_platform_owner();
 product_id:=public.pitacco_save_product(store_b,null,'Açaí teste','Açaí','',15,6,true);
 group_id:=public.pitacco_save_option_group(store_b,product_id,null,'Cobertura',0,1);
 option_id:=public.pitacco_save_option(store_b,group_id,null,'Morango',2.5,true);
 perform public.save_public_menu_settings(store_b,'loja-b',true,false,true,0,array['dinheiro'],'');
 assert (select price=15 from public.pitacco_list_products(store_b) where id=product_id);
 assert (public.pitacco_list_complements(store_b,product_id)->0->'options'->0->>'price')::numeric=2.5;
 assert public.pitacco_owner_menu_settings(store_b)->>'slug'='loja-b';
 placed:=public.checkout_public_order('loja-b',gen_random_uuid(),'Cliente','21999999999','',
  jsonb_build_array(jsonb_build_object('product_id',product_id,'quantity',1,'options',jsonb_build_array(option_id))),
  'pickup','dinheiro','');
 assert (placed->>'total')::numeric=17.50, 'Catalog edits affect the public checkout price';
 assert (select count(*) from public.stores)=2;
 perform public.pitacco_owner_set_feature(null,'estoque',false);
 perform public.pitacco_owner_set_feature('20000000-0000-0000-0000-000000000001','estoque',true);
 assert public.pitacco_store_features('20000000-0000-0000-0000-000000000002')->>'estoque'='false';
 assert public.pitacco_store_features('20000000-0000-0000-0000-000000000001')->>'estoque'='true';
 perform public.pitacco_owner_set_feature('20000000-0000-0000-0000-000000000001','estoque',null);
 assert public.pitacco_store_features('20000000-0000-0000-0000-000000000001')->>'estoque'='false';
end;
$test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
 assert not public.is_admin(), 'An admin profile alone is insufficient';
 assert not public.pitacco_is_platform_owner(), 'Admin access check requires the designated owner';
 assert (select count(*) from public.stores)=1;
 assert (select count(*) from public.pitacco_list_products('20000000-0000-0000-0000-000000000002'))=0;
 perform public.pitacco_save_product('20000000-0000-0000-0000-000000000001',null,'Produto do gestor','','',10,3,false);
 begin
  perform public.pitacco_save_product('20000000-0000-0000-0000-000000000002',null,'Outra Loja','','',10,3,false);
  raise exception 'Expected cross-store catalog write to fail';
 exception when raise_exception then
  if sqlerrm<>'Sem permissão para alterar produtos' then raise;end if;
 end;
 begin
  perform public.pitacco_owner_menu_settings('20000000-0000-0000-0000-000000000001');
  raise exception 'Expected owner-only settings reader';
 exception when raise_exception then
  if sqlerrm<>'Acesso exclusivo do proprietário do Pitacco' then raise;end if;
 end;
 assert public.pitacco_store_features('20000000-0000-0000-0000-000000000001')->>'estoque'='false';
 begin
  perform public.pitacco_owner_set_feature(null,'estoque',true);
  raise exception 'Expected owner-only authorization';
 exception when raise_exception then
  if sqlerrm<>'Acesso exclusivo do proprietário do Pitacco' then raise;end if;
 end;
end;
$test$;
reset role;
do $test$
begin
 assert not has_function_privilege('anon','public.pitacco_is_platform_owner()','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_lookup_platform_owner_login(text)','EXECUTE');
 assert not has_function_privilege('authenticated','public.pitacco_lookup_platform_owner_login(text)','EXECUTE');
 assert (select count(*) from pitacco_private.store_feature_audit)=3;
 assert (select count(*) from public.operation_audit where action like 'owner_catalog_%_saved')=3;
end;
$test$;
rollback;

-- An invitation is claimed only by the authenticated account with the exact verified email.
begin;
do $test$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();s uuid;t uuid;mail text:='pending-'||gen_random_uuid()||'@example.invalid';
begin
 insert into public.stores(name) values('Merchant access A') returning id into s;
 insert into public.stores(name) values('Merchant access B') returning id into t;
 insert into auth.users(id,email,email_confirmed_at) values(a,mail,null),(b,'other-'||gen_random_uuid()||'@example.invalid',now());
 insert into public.store_members(store_id,user_id,role) values(t,b,'gestor');
 insert into pitacco_private.store_member_invites(store_id,email) values(s,mail);
 perform set_config('request.jwt.claim.sub',a::text,true);
 assert not exists(select 1 from public.pitacco_my_merchant_stores());
 perform set_config('request.jwt.claim.sub',b::text,true);
 assert (select array_agg(id) from public.pitacco_my_merchant_stores())=array[t];
 update auth.users set email_confirmed_at=now() where id=a;
 perform set_config('request.jwt.claim.sub',a::text,true);
 assert (select array_agg(id) from public.pitacco_my_merchant_stores())=array[s];
 assert (select role from public.store_members where store_id=s and user_id=a)='gestor';
 assert (select claimed_by from pitacco_private.store_member_invites where store_id=s)=a;
 -- Even platform-owner authority must not widen the operational selector.
 insert into pitacco_private.platform_owner(user_id,login_name_hash) values(a,sha256(convert_to('00000000001','UTF8')));
 assert public.is_admin();
 assert (select array_agg(id) from public.pitacco_my_merchant_stores())=array[s];
 assert not has_function_privilege('anon','public.pitacco_my_merchant_stores()','EXECUTE');
 assert not has_table_privilege('authenticated','pitacco_private.store_member_invites','SELECT');
end $test$;
rollback;
