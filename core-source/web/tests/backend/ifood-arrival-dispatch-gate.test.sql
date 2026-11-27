-- Regressão transacional: nenhum dado permanece após o teste.
-- A sessão do courier é simulada, mas o vínculo entre loja/courier/order
-- e a exigência de evento DISPATCHED são executados pelo SQL de produção.
begin;
-- A fixture de migrações não inclui todos os campos da entrega adicionados
-- por scripts operacionais antigos; só no teste reproduzimos o esquema de produção.
alter table public.deliveries add column if not exists arrived_at timestamptz;
alter table public.deliveries add column if not exists collected_at timestamptz;
alter table public.deliveries add column if not exists arrival_provider_state text not null default 'none';
alter table public.deliveries add column if not exists delivery_code_verified_at timestamptz;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000071','driver-dispatch-gate@example.invalid'),
 ('10000000-0000-0000-0000-000000000072','outsider-dispatch-gate@example.invalid');
insert into public.profiles(id,email,role) values
 ('10000000-0000-0000-0000-000000000071','driver-dispatch-gate@example.invalid','entregador'),
 ('10000000-0000-0000-0000-000000000072','outsider-dispatch-gate@example.invalid','entregador')
on conflict(id) do nothing;
insert into public.stores(id,name) values
 ('20000000-0000-0000-0000-000000000071','Loja de teste despacho confirmado');
insert into public.couriers(id,user_id,name,fleet_type,store_id,active)
values ('30000000-0000-0000-0000-000000000071',
 '10000000-0000-0000-0000-000000000071','Courier Teste','propria',
 '20000000-0000-0000-0000-000000000071',true);
insert into public.orders(id,store_id,channel,gross,status,preparation_status,source,receipt)
values ('40000000-0000-0000-0000-000000000071',
 '20000000-0000-0000-0000-000000000071','iFood',20.00,'accepted','ready','ifood',
 '{"ifood_status":"READY_TO_PICKUP","logistics":"loja","customer":"Teste"}'::jsonb);
insert into public.deliveries(id,store_id,order_id,courier_id,customer_name,address,
 status,source,logistics_provider,collected_at,arrived_at,arrival_provider_state)
values ('50000000-0000-0000-0000-000000000071',
 '20000000-0000-0000-0000-000000000071',
 '40000000-0000-0000-0000-000000000071',
 '30000000-0000-0000-0000-000000000071',
 'Teste iFood','Endereço de teste, não enviar', 'retirada','ifood','loja',now(),now(),'none');
insert into pitacco_private.ifood_merchants(merchant_id,store_id,test_only,enabled)
values ('60000000-0000-0000-0000-000000000071',
 '20000000-0000-0000-0000-000000000071',true,true);
insert into pitacco_private.ifood_order_links(external_id,order_id,merchant_id,state_rank,event_at)
values ('70000000-0000-0000-0000-000000000071',
 '40000000-0000-0000-0000-000000000071',
 '60000000-0000-0000-0000-000000000071',3,now());

-- Neste fixture isolado só simulamos a existência da sessão do usuário.
-- A checagem de vínculo com o entregador é mantida na função real.
create or replace function public.pitacco_courier_session_ready()
returns boolean language sql stable security definer set search_path=''
as $$ select (select auth.uid()) is not null $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000071',true);
do $check$
declare v jsonb;
begin
 -- HTTP 202 do dispatch não equivale ao evento oficial DISPATCHED.
 begin
  perform public.pitacco_driver_ifood_action('50000000-0000-0000-0000-000000000071','arrival');
  raise exception 'Chegada externa não deveria ter sido autorizada antes do DISPATCHED';
 exception when sqlstate '22023' then
  assert sqlerrm like '%DISPATCHED%', 'Falha deve mencionar a confirmação oficial';
 end;
 v:=public.pitacco_driver_ifood_action('50000000-0000-0000-0000-000000000071','verify');
 assert v->>'external_order_id'='70000000-0000-0000-0000-000000000071',
   'Código de entrega não deve perder seu acesso legítimo';
end $check$;

-- Chamada de serviço não deve registrar chegada externamente antes do evento.
reset role;
set local role service_role;
do $check$
begin
 assert not public.pitacco_ifood_driver_result(
  '50000000-0000-0000-0000-000000000071',
  '70000000-0000-0000-0000-000000000071','arrival',true,false);
 assert (select arrival_provider_state='none' from public.deliveries
 where id='50000000-0000-0000-0000-000000000071');
end $check$;

-- O webhook iFood confirma DISPATCHED; só agora a API da chegada é autorizada.
update public.orders set receipt=receipt||'{"ifood_status":"DISPATCHED"}'::jsonb
 where id='40000000-0000-0000-0000-000000000071';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000071',true);
do $check$
declare v jsonb;
begin
 v:=public.pitacco_driver_ifood_action('50000000-0000-0000-0000-000000000071','arrival');
 assert v->>'external_order_id'='70000000-0000-0000-0000-000000000071',
  'Depois do DISPATCHED, chamada legítima deve continuar disponível';
end $check$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000072',true);
do $check$
begin
 begin
  perform public.pitacco_driver_ifood_action('50000000-0000-0000-0000-000000000071','arrival');
  raise exception 'Outro motoboy não pode comunicar chegada';
 exception when insufficient_privilege then null;
 end;
end $check$;

reset role;
set local role service_role;
do $check$
begin
 assert public.pitacco_ifood_driver_result(
  '50000000-0000-0000-0000-000000000071',
  '70000000-0000-0000-0000-000000000071','arrival',true,false);
 assert (select arrival_provider_state='submitted' from public.deliveries
 where id='50000000-0000-0000-0000-000000000071');
end $check$;

-- Um pedido CANCELLED ou CONCLUDED não pode emitir nova chegada externa.
update public.orders set receipt=receipt||'{"ifood_status":"CONCLUDED"}'::jsonb
 where id='40000000-0000-0000-0000-000000000071';
update public.deliveries set arrival_provider_state='pending'
 where id='50000000-0000-0000-0000-000000000071';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000071',true);
do $check$
begin
 begin
  perform public.pitacco_driver_ifood_action('50000000-0000-0000-0000-000000000071','arrival');
  raise exception 'CONCLUDED não deve autorizar nova chegada';
 exception when sqlstate '22023' then null;
 end;
end $check$;
rollback;