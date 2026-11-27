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
 ('30000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','Açaí clone','Açaí',20,8,true);
insert into public.product_option_groups(id,store_id,product_id,name,min_select,max_select) values
 ('40000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','30000000-0000-0000-0000-000000000091','Frutas',0,2);
insert into public.product_options(id,store_id,group_id,name,additional_price,available) values
 ('50000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000091','40000000-0000-0000-0000-000000000091','Banana',2,true);
update public.stores set instagram_url='https://www.instagram.com/destino/',facebook_url='https://www.facebook.com/destino',phone='21900000000' where id='20000000-0000-0000-0000-000000000092';
update public.public_menu_settings set payment_methods=array['dinheiro'],pix_instructions='PIX exclusivo destino' where store_id='20000000-0000-0000-0000-000000000092';
insert into public.pitacco_storefront_designs(store_id,draft,published,draft_version,published_version)
select id,design,design,1,1 from (select s.id,pitacco_private.storefront_design_default(s.id)||jsonb_build_object('slogan',case when s.id='20000000-0000-0000-0000-000000000091' then 'Slogan origem' else 'Slogan destino' end,'primary',case when s.id='20000000-0000-0000-0000-000000000091' then '#ff0000' else '#224488' end,'layout',case when s.id='20000000-0000-0000-0000-000000000091' then 'grade' else 'lista' end) design from public.stores s where s.id in ('20000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000092')) q
on conflict(store_id) do update set draft=excluded.draft,published=excluded.published,draft_version=1,published_version=1;
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
 assert (select instagram_url='https://www.instagram.com/destino/' and phone='21900000000' from public.stores where id=dst);
 assert (select payment_methods=array['dinheiro'] and pix_instructions='PIX exclusivo destino' from public.public_menu_settings where store_id=dst);
 assert public.pitacco_storefront_studio_state(dst)#>>'{published,layout}'='grade';
 assert public.pitacco_storefront_studio_state(dst)#>>'{published,primary}'='#224488';
 assert public.pitacco_storefront_studio_state(dst)#>>'{published,slogan}'='Slogan destino';
 assert res->>'products'='1' and res->>'groups'='1' and res->>'options'='1';
 assert public.pitacco_owner_copy_catalog(src,dst,null,req)=res,'Retry must not duplicate rows';
 select id into pid from public.products where store_id=dst and name='Açaí clone';
 assert pid<>'30000000-0000-0000-0000-000000000091';
 assert (select price=20 and cost=0 and menu_active from public.products where id=pid);
 assert (select count(*) from public.products where store_id=dst)=1;
 assert (public.pitacco_list_complements(dst,pid)->0->'options'->0->>'price')::numeric=2;
 begin perform public.pitacco_owner_copy_catalog(src,dst,null,gen_random_uuid());raise exception 'Expected duplicate rejection';exception when raise_exception then if sqlerrm not like 'O destino precisa ter catálogo vazio%' then raise;end if;end;
 res:=public.pitacco_owner_copy_catalog(src,null,'Nova unidade clone',gen_random_uuid());new_store:=(res->>'store_id')::uuid;
 assert new_store<>src and new_store<>dst;
 assert (select name='Nova unidade clone' and phone is null and address is null from public.stores where id=new_store);
 assert not exists(select 1 from public.store_members where store_id=new_store);
 assert (select not enabled from public.public_menu_settings where store_id=new_store);
 assert (select count(*) from public.products where store_id=new_store)=1;
 assert (select menu_active from public.products where store_id=src and name='Açaí clone');
end $test$;
rollback;
