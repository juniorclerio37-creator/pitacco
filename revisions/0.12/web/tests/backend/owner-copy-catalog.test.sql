begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000091','clone-owner@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000092','clone-manager@example.invalid',now());
insert into pitacco_private.platform_owner(user_id,login_name_hash) values
 ('10000000-0000-0000-0000-000000000091',sha256(convert_to('00000000091','UTF8')));
insert into public.stores(id,name,phone,address) values
 ('20000000-0000-0000-0000-000000000091','Origem clone','21999999999','Rua privada'),
 ('20000000-0000-0000-0000-000000000092','Destino clone',null,null);
insert into public.store_members values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000092','gestor');
insert into public.products(id,store_id,name,category,price,cost,menu_active) values
 ('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','Açaí clone','Açaí',20,8,true),
 ('30000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000092','Produto existente','Outros',5,1,true);
insert into public.product_option_groups(id,store_id,product_id,name,min_select,max_select) values
 ('40000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091','Frutas',0,2);
insert into public.product_options(id,store_id,group_id,name,additional_price,available) values
 ('50000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','40000000-0000-0000-0000-000000000091','Banana',2,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000092',true);
do $test$ begin
 begin perform public.pitacco_owner_copy_catalog('20000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000092',null,gen_random_uuid());raise exception 'Unauthorized clone accepted';exception when insufficient_privilege then null;end;
end $test$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000091',true);
do $test$
declare src uuid:='20000000-0000-0000-0000-000000000091'; dst uuid:='20000000-0000-0000-0000-000000000092'; req uuid:=gen_random_uuid(); res jsonb; new_store uuid; pid uuid;
begin
 res:=public.pitacco_owner_copy_catalog(src,dst,null,req);
 assert res->>'products'='1' and res->>'groups'='1' and res->>'options'='1';
 assert public.pitacco_owner_copy_catalog(src,dst,null,req)=res,'Retry must not duplicate rows';
 select id into pid from public.products where store_id=dst and name='Açaí clone';
 assert pid<>'30000000-0000-0000-0000-000000000091';
 assert (select price=20 and cost=0 and not menu_active from public.products where id=pid);
 assert (select count(*) from public.products where store_id=dst)=2;
 assert (public.pitacco_list_complements(dst,pid)->0->'options'->0->>'price')::numeric=2;
 begin perform public.pitacco_owner_copy_catalog(src,dst,null,gen_random_uuid());raise exception 'Expected duplicate rejection';exception when raise_exception then if sqlerrm not like 'Já existem produtos%' then raise;end if;end;
 res:=public.pitacco_owner_copy_catalog(src,null,'Nova unidade clone',gen_random_uuid());new_store:=(res->>'store_id')::uuid;
 assert new_store<>src and new_store<>dst;
 assert (select name='Nova unidade clone' and phone is null and address is null from public.stores where id=new_store);
 assert not exists(select 1 from public.store_members where store_id=new_store);
 assert (select not enabled from public.public_menu_settings where store_id=new_store);
 assert (select count(*) from public.products where store_id=new_store)=1;
 assert (select menu_active from public.products where store_id=src and name='Açaí clone');
end $test$;
rollback;
