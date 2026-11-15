begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','owner@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','manager@example.invalid');
update public.profiles set role='admin' where id='10000000-0000-0000-0000-000000000001';
insert into pitacco_private.platform_owner(user_id) values ('10000000-0000-0000-0000-000000000001');
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000001','Loja para homologação');
insert into public.store_members values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values ('20000000-0000-0000-0000-000000000001','cardapio-isolado',true,false,true,0,array['pix_manual'],'');
insert into public.products(store_id,name,price,cost,menu_active)
 values ('20000000-0000-0000-0000-000000000001','Produto',5,0,true);
update pitacco_private.subscription_control set asaas_environment='sandbox';
insert into pitacco_private.asaas_subscription_bindings(environment,subscription_id,store_id)
 values ('sandbox','sub_test','20000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $test$
begin
 begin
  perform public.pitacco_admin_homologation_results();
  raise exception 'Expected history authorization';
 exception when raise_exception then
  if sqlerrm<>'Acesso exclusivo da administração do Pitacco' then raise; end if;
 end;
 begin
  perform public.pitacco_admin_record_homologation('20000000-0000-0000-0000-000000000001','pedidos','approved','Teste',gen_random_uuid());
  raise exception 'Expected write authorization';
 exception when raise_exception then
  if sqlerrm<>'Acesso exclusivo da administração do Pitacco' then raise; end if;
 end;
 begin
  perform public.pitacco_admin_homologation_probe('20000000-0000-0000-0000-000000000001');
  raise exception 'Expected probe authorization';
 exception when raise_exception then
  if sqlerrm<>'Acesso exclusivo da administração do Pitacco' then raise; end if;
 end;
end;
$test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $test$
declare
 store uuid:='20000000-0000-0000-0000-000000000001';
 attempt uuid:=gen_random_uuid();
 report jsonb;
 entry bigint;
begin
 report:=public.pitacco_admin_homologation_probe(store,'sub_test','pay_test');
 assert report->>'menu_slug'='cardapio-isolado' and report->>'menu_has_checkout'='true';
 assert report->>'sandbox_payment_linked'='true' and report->>'sandbox_payment_recorded'='false';
 entry:=public.pitacco_admin_record_homologation(store,'pedidos','approved','Checkout testado',attempt);
 assert public.pitacco_admin_record_homologation(store,'pedidos','approved','Checkout testado',attempt)=entry;
 assert (select count(*) from public.pitacco_admin_homologation_results())=1;
 assert (select notes='Checkout testado' from public.pitacco_admin_homologation_results() where id=entry);
end;
$test$;
reset role;
rollback;
