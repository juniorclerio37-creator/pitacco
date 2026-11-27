begin;
-- V2: endereço salvo exclusivamente com segredo do dispositivo, não pelo número.
insert into public.stores(id,name) values
 ('30000000-0000-0000-0000-000000000091','Loja V2 A'),
 ('30000000-0000-0000-0000-000000000092','Loja V2 B');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions) values
 ('30000000-0000-0000-0000-000000000091','v2-profile-a',true,true,true,0,array['pix_manual'],'chave Pix loja A'),
 ('30000000-0000-0000-0000-000000000092','v2-profile-b',true,true,true,0,array['dinheiro'],'');
select set_config('request.jwt.claim.sub','',true);
do $v2test$
declare saved jsonb;reloaded jsonb;source jsonb;
 dev text:='11111111-1111-4111-8111-111111111111';
 other text:='22222222-2222-4222-8222-222222222222';
 p jsonb:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,
  'label','Casa','street','Rua das Acácias','number','123','neighborhood','Centro',
  'city','Nova Iguaçu','state','RJ','postal','26000000','extra','Casa 2',
  'is_default',true));
begin
 assert not has_table_privilege('anon','public.pitacco_v2_customer_profiles','select'),
  'Pessoas sem login não leem endereços diretamente';
 assert (public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'load')->>'found')::boolean=false,
  'Primeiro uso sem dados anteriores não revela cadastro de outros aparelhos';
 saved:=public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'save','Cliente A',p);
 assert (saved->>'found')::boolean and jsonb_array_length(saved->'addresses')=1,
  'Salvou endereço estruturado por telefone e loja';
 reloaded:=public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'load');
 assert reloaded->>'name'='Cliente A';
 assert reloaded->'addresses'->0->>'street'='Rua das Acácias';
 assert (public.pitacco_v2_customer_profile('v2-profile-a','21999990001',other,'load')->>'found')::boolean=false,
  'Mesmo telefone sem token privado não acessa endereços';
 assert (public.pitacco_v2_customer_profile('v2-profile-a','21999990002',dev,'load')->>'found')::boolean=false,
  'Outra pessoa no mesmo aparelho não recebe endereços de outro telefone';
 assert (public.pitacco_v2_customer_profile('v2-profile-b','21999990001',dev,'load')->>'found')::boolean=false,
  'Lojas diferentes não compartilham perfis';
 assert jsonb_array_length((public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'save','Cliente A',p)->'addresses'))=1,
  'Editar cadastro não duplica endereços';
 assert (public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'save','Cliente A',
  jsonb_build_array(jsonb_build_object('street','Rua')))->>'error') is not null,
  'Não aceita endereço incompleto';
 insert into public.pitacco_delivery_route_quotes(id,store_id,request_id,destination_address,distance_m,fee,pricing_updated_at,expires_at,destination_latitude,destination_longitude,address_point_selected)
 values('30000000-0000-0000-0000-000000000093','30000000-0000-0000-0000-000000000091',gen_random_uuid(),
  'Rua das Acácias, 123, Centro, Nova Iguaçu, RJ, CEP 26000000, Casa 2',500,5,now(),now()+interval '5 minutes',-22.71,-43.41,true);
 saved:=public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'save','Cliente A',
  jsonb_build_array((p->0)||'{"quote_id":"30000000-0000-0000-0000-000000000093"}'::jsonb));
 assert (saved->'addresses'->0->'location'->>'latitude')::numeric=-22.71,'Validated delivery point must persist';
 assert (public.pitacco_customer_device_session('v2-profile-a',dev,'resume')->'addresses'->0->'location'->>'longitude')::numeric=-43.41,'Resume restores point';
 saved:=public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'save','Cliente A',p);
 assert (saved->'addresses'->0->'location'->>'latitude')::numeric=-22.71,'Older client does not erase point';
 saved:=public.pitacco_v2_customer_profile('v2-profile-a','21999990001',dev,'save','Cliente A',
  jsonb_build_array((p->0)||'{"number":"124","quote_id":"30000000-0000-0000-0000-000000000093","location":{"latitude":-22.71,"longitude":-43.41}}'::jsonb));
 assert not (saved->'addresses'->0 ? 'location'),'Different house cannot inherit point';
 saved:=public.pitacco_v2_customer_profile('v2-profile-b','21999990001',other,'save','Cliente B',
  jsonb_build_array((p->0)||'{"quote_id":"30000000-0000-0000-0000-000000000093"}'::jsonb));
 assert not (saved->'addresses'->0 ? 'location'),'Other store cannot reuse quote';
 source:=public.pitacco_v2_fiado_statement('v2-profile-a',gen_random_uuid());
 assert source ? 'error', 'Extrato exige PIN validado e token único';
end $v2test$;
rollback;