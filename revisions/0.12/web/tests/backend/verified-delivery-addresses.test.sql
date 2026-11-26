begin;
insert into auth.users(id,email) values ('90000000-0000-0000-0000-000000000061','verified-address@example.invalid');
insert into public.stores(id,name) values ('90000000-0000-0000-0000-000000000062','Verified address test'),('90000000-0000-0000-0000-000000000063','Other shop');
insert into public.store_members(store_id,user_id,role) values ('90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000061','gestor');
insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude) values
('90000000-0000-0000-0000-000000000064','90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000065','Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000, apto privado',500,5,now(),now()+interval '5 minutes',-22.7,-43.4),
('90000000-0000-0000-0000-000000000066','90000000-0000-0000-0000-000000000063','90000000-0000-0000-0000-000000000067','Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000',500,5,now(),now()+interval '5 minutes',-22.8,-43.4);
insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,created_at,destination_latitude,destination_longitude) values ('90000000-0000-0000-0000-000000000068','90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000069','Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000',500,5,now(),now()+interval '5 minutes',now()-interval '1 minute',-22.75,-43.4);
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000061',true);
do $test$
declare s uuid:='90000000-0000-0000-0000-000000000062';
begin
 assert public.pitacco_save_verified_delivery_address(s,'90000000-0000-0000-0000-000000000064')='{"saved":true}'::jsonb;
 -- Older in-flight automatic writes must never replace the latest chosen point.
 perform public.pitacco_save_verified_delivery_address(s,'90000000-0000-0000-0000-000000000068');
 begin
  perform public.pitacco_save_verified_delivery_address(s,'90000000-0000-0000-0000-000000000066');
  raise exception 'Expected wrong store quote rejection';
 exception when raise_exception then if sqlerrm not like 'Recalcule o frete%' then raise;end if;end;
 assert not has_function_privilege('anon','public.pitacco_save_verified_delivery_address(uuid,uuid)','execute');
 assert not has_function_privilege('authenticated','public.pitacco_service_verified_delivery_address(uuid,text)','execute');
 assert not has_function_privilege('anon','public.pitacco_service_verified_delivery_address(uuid,text)','execute');
end $test$;
reset role;
set local role service_role;
do $test$
declare s uuid:='90000000-0000-0000-0000-000000000062';r jsonb;
begin
 r:=public.pitacco_service_verified_delivery_address(s,'R. Exemplo, 39, Bairro Teste, Nova Iguacu, rj, CEP 26000-000');
 assert r->>'exact'='true' and (r->>'latitude')::numeric=-22.7;
 r:=public.pitacco_service_verified_delivery_address(s,'Rua Exemplo, 45, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000');
 assert r->>'exact'='false';
 assert public.pitacco_service_verified_delivery_address(s,'Rua Exemplo, 39, Outro Bairro, Nova Iguaçu, RJ, CEP 26000000') is null;
 assert public.pitacco_service_verified_delivery_address('90000000-0000-0000-0000-000000000063','Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000') is null;
end $test$;
reset role;
-- A customer pin must correspond to a real order and can only be promoted on completion.
insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,address_point_selected) values
('90000000-0000-0000-0000-000000000070','90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000071','Rua Nova, 12, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000',500,5,now(),now()+interval '5 minutes',-22.71,-43.41,true),
('90000000-0000-0000-0000-000000000072','90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000073','Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000',500,5,now(),now()+interval '5 minutes',-22.78,-43.41,true);
insert into public.orders(id,store_id,request_id,channel,gross,fees,source,status,preparation_status,receipt)
values
('90000000-0000-0000-0000-000000000074','90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000071','Delivery próprio',25,0,'proprio','accepted','preparing','{"address":"Rua Nova, 12, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000"}'),
('90000000-0000-0000-0000-000000000075','90000000-0000-0000-0000-000000000062','90000000-0000-0000-0000-000000000073','Delivery próprio',25,0,'proprio','accepted','preparing','{"address":"Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000"}');
do $test$
begin
 assert (select count(*) from pitacco_private.delivery_address_observations)=2;
 assert public.pitacco_service_verified_delivery_address('90000000-0000-0000-0000-000000000062','Rua Nova, 12, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000') is null;
end $test$;
update public.orders set preparation_status='completed' where id in ('90000000-0000-0000-0000-000000000074','90000000-0000-0000-0000-000000000075');
do $test$
declare s uuid:='90000000-0000-0000-0000-000000000062';
begin
 assert (public.pitacco_service_verified_delivery_address(s,'Rua Nova, 12, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000')->>'exact')='true';
 assert (public.pitacco_service_verified_delivery_address(s,'Rua Exemplo, 39, Bairro Teste, Nova Iguaçu, RJ, CEP 26000000')->>'latitude')::numeric=-22.7,'Customer cannot overwrite merchant-confirmed address';
 assert (select count(*) from pitacco_private.delivery_address_observations)=0;
end $test$;
rollback;
