begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000001','owner@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000002','other@example.invalid',now());
update public.profiles set role='admin';
insert into pitacco_private.platform_owner(user_id) values ('10000000-0000-0000-0000-000000000001');
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000001','Loja A'),
 ('20000000-0000-0000-0000-000000000002','Loja B');
insert into public.store_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
begin
 assert public.is_admin();
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
 assert (select count(*) from public.stores)=1;
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
 assert (select count(*) from pitacco_private.store_feature_audit)=3;
end;
$test$;
rollback;
