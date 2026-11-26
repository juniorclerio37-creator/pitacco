begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-0000-0000-000000000081','insights-manager@example.invalid',now()),
 ('10000000-0000-0000-0000-000000000082','insights-other@example.invalid',now());
insert into public.stores(id,name) values ('20000000-0000-0000-0000-000000000081','Loja insights'),('20000000-0000-0000-0000-000000000082','Outra insights');
insert into public.store_members values ('20000000-0000-0000-0000-000000000081','10000000-0000-0000-0000-000000000081','gestor');
insert into public.pitacco_ingredients(store_id,name,unit,minimum) values ('20000000-0000-0000-0000-000000000081','Açaí teste','g',100),('20000000-0000-0000-0000-000000000082','Insumo privado','g',100);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000081',true);
do $test$
declare d jsonb;
begin
 d:=public.pitacco_business_insights('20000000-0000-0000-0000-000000000081');
 assert d#>>'{sales,orders}'='0';
 assert d#>'{sales,known_contribution}'='null'::jsonb;
 assert jsonb_array_length(d->'weekdays')=7;
 assert jsonb_array_length(d->'stock_alerts')=1;
 assert d#>>'{stock_alerts,0,name}'='Açaí teste';
 assert d#>'{stock_alerts,0,days_left}'='null'::jsonb;
 begin perform public.pitacco_business_insights('20000000-0000-0000-0000-000000000082');raise exception 'Cross-store access accepted';exception when insufficient_privilege then null;end;
end $test$;
reset role;

-- Exercise nonempty reports, cost coverage, exclusions and Brazilian calendar boundaries.
insert into public.orders(id,store_id,channel,gross,fees,created_at,source,status)
select id::uuid,store_id::uuid,'iFood',gross,fees,((now() at time zone 'America/Sao_Paulo')::date + day_offset)::timestamp at time zone 'America/Sao_Paulo','ifood',status
from (values
 ('30000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000081',100,10,-1,'accepted'),
 ('30000000-0000-0000-0000-000000000082','20000000-0000-0000-0000-000000000081',20,2,-2,'accepted'),
 ('30000000-0000-0000-0000-000000000083','20000000-0000-0000-0000-000000000081',50,0,-28,'historical'),
 ('30000000-0000-0000-0000-000000000084','20000000-0000-0000-0000-000000000081',900,0,-29,'accepted'),
 ('30000000-0000-0000-0000-000000000085','20000000-0000-0000-0000-000000000081',900,0,0,'accepted'),
 ('30000000-0000-0000-0000-000000000086','20000000-0000-0000-0000-000000000081',900,0,-1,'rejected'),
 ('30000000-0000-0000-0000-000000000087','20000000-0000-0000-0000-000000000082',900,0,-1,'accepted')
) as v(id,store_id,gross,fees,day_offset,status);
insert into public.pitacco_order_costs(order_id,store_id,merchant_discount,goods_cost,processing_fees,delivery_cost,other_cost) values
 ('30000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000081',0,22,3,8,2),
 ('30000000-0000-0000-0000-000000000082','20000000-0000-0000-0000-000000000081',0,25,1,2,0);

insert into public.products(id,store_id,name,category,price,cost,menu_active) values
 ('40000000-0000-0000-0000-000000000081','20000000-0000-0000-0000-000000000081','Açaí','Açaí',20,8,true),
 ('40000000-0000-0000-0000-000000000082','20000000-0000-0000-0000-000000000081','Bebida','Bebidas',6,2,true),
 ('40000000-0000-0000-0000-000000000083','20000000-0000-0000-0000-000000000081','Produto indisponível','Bebidas',8,2,true),
 ('40000000-0000-0000-0000-000000000084','20000000-0000-0000-0000-000000000082','Outra loja','Bebidas',8,2,true);
insert into public.pitacco_finished_product_stock(store_id,product_id,enabled,balance) values
 ('20000000-0000-0000-0000-000000000081','40000000-0000-0000-0000-000000000083',true,0);
update public.orders set receipt=jsonb_build_object('items',jsonb_build_array(
 jsonb_build_object('product_id','40000000-0000-0000-0000-000000000081','quantity',1),
 jsonb_build_object('product_id','40000000-0000-0000-0000-000000000081','quantity',1),
 jsonb_build_object('product_id','40000000-0000-0000-0000-000000000082','quantity',1),
 jsonb_build_object('product_id','40000000-0000-0000-0000-000000000083','quantity',1),
 jsonb_build_object('product_id','40000000-0000-0000-0000-000000000084','quantity',1)
 )) where id in ('30000000-0000-0000-0000-000000000081','30000000-0000-0000-0000-000000000082','30000000-0000-0000-0000-000000000083');
set local role authenticated;
do $test$
declare d jsonb;
begin
 d:=public.pitacco_business_insights('20000000-0000-0000-0000-000000000081');
 assert (d#>>'{sales,orders}')::int=3;
 assert (d#>>'{sales,gross}')::numeric=170;
 assert (d#>>'{sales,complete_costs}')::int=2;
 assert (d#>>'{sales,negative_orders}')::int=1;
 assert (d#>>'{sales,known_contribution}')::numeric=45;
 assert (select sum((v->>'orders')::int)=3 from jsonb_array_elements(d->'weekdays') v);
 assert jsonb_array_length(d->'catalog')=2;
 assert jsonb_array_length(d->'combo_candidates')=1;
 assert (d#>>'{combo_candidates,0,together_orders}')::int=3;
 assert (d#>>'{identified_orders}')::int=3;
 assert (d#>>'{catalog,0,orders}')::int=3;
end $test$;
reset role;
rollback;

