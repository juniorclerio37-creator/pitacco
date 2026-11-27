-- CI ONLY: original assignment with scoped identity and store checks.
create function core_auth.merchant_dispatch_fixture(s uuid,c uuid,ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $fn$
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 if not exists(select 1 from public.couriers where id=c and store_id=s and fleet_type='propria' and active) then raise exception 'Entregador não autorizado' using errcode='42501';end if;
 if ids is null or cardinality(ids)<2 or cardinality(ids)>15 or cardinality(ids)<>(select count(distinct u) from unnest(ids) u) then raise exception 'Seleção inválida' using errcode='22023';end if;
 if cardinality(ids)<>(select count(*) from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.id=any(ids) and d.store_id=s and d.source='proprio' and o.source='proprio' and d.logistics_provider='loja') then raise exception 'Entrega não autorizada' using errcode='42501';end if;
 if exists(select 1 from public.deliveries d left join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.courier_id=c and d.status not in ('entregue','cancelada') and (d.store_id is distinct from s or d.source is distinct from 'proprio' or o.source is distinct from 'proprio' or d.logistics_provider is distinct from 'loja')) then raise exception 'Rota exige integração específica' using errcode='42501';end if;
 return public.assign_delivery_batch(s,c,ids);
end $fn$;
revoke all on function core_auth.merchant_dispatch_fixture(uuid,uuid,uuid[]) from public,anon,authenticated;
create role pitacco_core_merchant_dispatch login password 'ci-merchant-dispatch-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_merchant_dispatch;
grant execute on function core_auth.can_act(uuid),core_auth.merchant_dispatch_fixture(uuid,uuid,uuid[]) to pitacco_core_merchant_dispatch;
-- Previous administrative regression intentionally revokes this fixture membership.
-- Restore only the known synthetic owner for this independent CI scenario.
do $fixture$
begin
 assert exists(select 1 from core_auth.memberships where user_id='10000000-0000-4000-8000-000000000001' and store_id='20000000-0000-4000-8000-000000000001' and role='owner' and not active), 'Expected revoked synthetic owner from preceding regression';
 update core_auth.memberships set active=true where user_id='10000000-0000-4000-8000-000000000001' and store_id='20000000-0000-4000-8000-000000000001' and role='owner';
end $fixture$;
-- The earlier test deliberately left a locked synthetic delivery open. End that
-- fixture via the original order cancellation trigger, not by bypassing PIN.
update public.orders set status='cancelled' where id='98000000-0000-0000-0000-000000000012';
update public.stores set max_orders_per_trip=2,delivery_mode='propria' where id='20000000-0000-4000-8000-000000000001';
insert into public.courier_positions(courier_id,latitude,longitude,accuracy_m,observed_at)
values('98000000-0000-0000-0000-000000000002',-22.85,-43.45,15,now()-interval '3 minutes')
on conflict(courier_id) do update set observed_at=excluded.observed_at;
insert into public.orders(id,store_id,channel,gross,source,status,preparation_status,receipt) values
('98000000-0000-0000-0000-000000000031','20000000-0000-4000-8000-000000000001','Delivery próprio',25,'proprio','accepted','ready','{"payment":"pix_manual","logistics":"loja"}'),
('98000000-0000-0000-0000-000000000032','20000000-0000-4000-8000-000000000001','Delivery próprio',25,'proprio','accepted','preparing','{"payment":"pix_manual","logistics":"loja"}');
insert into public.deliveries(id,store_id,order_id,customer_name,address,status,source,logistics_provider) values
('98000000-0000-0000-0000-000000000041','20000000-0000-4000-8000-000000000001','98000000-0000-0000-0000-000000000031','Cliente Fixture','Rua Fixture','pendente','proprio','loja'),
('98000000-0000-0000-0000-000000000042','20000000-0000-4000-8000-000000000001','98000000-0000-0000-0000-000000000032','Cliente Fixture','Rua Fixture','pendente','proprio','loja');

-- Test-only bridge to the original individual assignment and reassignment routines.
create function core_auth.merchant_delivery_fixture(s uuid,did uuid,a text,expected uuid,c uuid,confirmed boolean) returns uuid
language plpgsql security definer set search_path='' as $fn$
declare d public.deliveries%rowtype;
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select x.* into d from public.deliveries x join public.orders o on o.id=x.order_id and o.store_id=x.store_id
 where x.id=did and x.store_id=s and x.source='proprio' and o.source='proprio' and x.logistics_provider='loja' for update of x;
 if not found then raise exception 'Entrega não autorizada' using errcode='42501';end if;
 if a not in ('assign','remove','reassign','resume') then raise exception 'Ação inválida' using errcode='22023';end if;
 if c is not null then
  if not exists(select 1 from public.couriers x where x.id=c and x.store_id=s and x.fleet_type='propria' and x.active) then raise exception 'Entregador não autorizado' using errcode='42501';end if;
  if exists(select 1 from public.deliveries x left join public.orders o on o.id=x.order_id and o.store_id=x.store_id where x.courier_id=c and x.status not in ('entregue','cancelada') and (x.store_id is distinct from s or x.source is distinct from 'proprio' or o.source is distinct from 'proprio' or x.logistics_provider is distinct from 'loja')) then raise exception 'Rota exige integração específica' using errcode='42501';end if;
 end if;
 if a='assign' then
  if expected is not null or c is null then raise exception 'Seleção inválida' using errcode='22023';end if;
  return public.assign_order_courier(did,c,confirmed);
 end if;
 if (a in ('remove','reassign') and expected is null) or (a='resume' and expected is not null) or (a='reassign' and c is null) or (a in ('remove','resume') and c is not null) then raise exception 'Seleção inválida' using errcode='22023';end if;
 return public.pitacco_manage_own_delivery(did,expected,c,a,confirmed);
end $fn$;
revoke all on function core_auth.merchant_delivery_fixture(uuid,uuid,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function core_auth.merchant_delivery_fixture(uuid,uuid,text,uuid,uuid,boolean) to pitacco_core_merchant_dispatch;
insert into auth.users(id,email) values('98000000-0000-0000-0000-000000000051','dispatch-second@example.invalid');
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available) values
('98000000-0000-0000-0000-000000000052','98000000-0000-0000-0000-000000000051','Fixture 2','propria','20000000-0000-4000-8000-000000000001',true,true);

-- Isolated worker role. No HTTP endpoint, store selector, direct table grants or service_role.
create role pitacco_core_auto_dispatch login password 'ci-auto-dispatch-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_auto_dispatch;
create function core_auth.geographic_dispatch_tick_fixture() returns boolean
language plpgsql security definer set search_path='' as $fn$
declare s uuid:='20000000-0000-4000-8000-000000000001';
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 -- Fail closed if eligible records or an active candidate's open route require a marketplace integration.
 if exists(select 1 from public.deliveries d left join public.orders o on o.id=d.order_id and o.store_id=d.store_id
 where d.store_id=s and d.status='pendente' and not d.manual_dispatch_hold and d.courier_id is null
 and (d.source is distinct from 'proprio' or o.source is distinct from 'proprio' or d.logistics_provider is distinct from 'loja')) then
  raise exception 'Escopo de logística não autorizado' using errcode='42501';
 end if;
 if exists(select 1 from public.couriers c join public.deliveries d on d.courier_id=c.id
 left join public.orders o on o.id=d.order_id and o.store_id=d.store_id
 where c.store_id=s and c.active and c.available and c.fleet_type='propria'
 and d.status not in ('entregue','cancelada') and d.capacity_released_at is null
 and (d.store_id is distinct from s or d.source is distinct from 'proprio' or o.source is distinct from 'proprio' or d.logistics_provider is distinct from 'loja')) then
  raise exception 'Escopo de rota não autorizado' using errcode='42501';
 end if;
 return pitacco_private.group_auto_one(s) is not null;
end $fn$;
revoke all on function core_auth.geographic_dispatch_tick_fixture() from public,anon,authenticated;
grant execute on function core_auth.geographic_dispatch_tick_fixture() to pitacco_core_auto_dispatch;

-- CI only: separate iFood own-fleet allocation; never call provider dispatch.
create function core_auth.ifood_delivery_fixture(s uuid,did uuid,a text,expected uuid,c uuid,confirmed boolean) returns uuid
language plpgsql security definer set search_path='' as $fn$
declare d public.deliveries%rowtype;
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select x.* into d from public.deliveries x join public.orders o on o.id=x.order_id and o.store_id=x.store_id
 where x.id=did and x.store_id=s and x.source='ifood' and o.source='ifood' and x.logistics_provider='loja' for update of x;
 if not found then raise exception 'Entrega não autorizada' using errcode='42501';end if;
 if not exists(select 1 from public.orders o where o.id=d.order_id and o.store_id=s and o.status='accepted' and o.preparation_status='ready' and o.receipt->>'ifood_status' in ('CONFIRMED','READY_TO_PICKUP') and coalesce(o.receipt->>'ifood_manual_cancel','')<>'requested') then raise exception 'Pedido iFood não está pronto ou confirmado' using errcode='22023';end if;
 if d.collected_at is not null or d.capacity_released_at is not null or d.status not in ('pendente','atribuida','aceita') or coalesce(d.external_delivery_status,'') in ('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN') or exists(select 1 from pitacco_private.ifood_courier_dispatch x where x.delivery_id=d.id and x.state in ('claimed','submitted','uncertain')) then raise exception 'Entrega já encaminhada ou com solicitação externa' using errcode='22023';end if;
 if a not in ('assign','remove','reassign','resume') then raise exception 'Ação inválida' using errcode='22023';end if;
 if c is not null then
  if not exists(select 1 from public.couriers x where x.id=c and x.store_id=s and x.fleet_type='propria' and x.active) then raise exception 'Entregador não autorizado' using errcode='42501';end if;
  if exists(select 1 from public.deliveries x left join public.orders o on o.id=x.order_id and o.store_id=x.store_id where x.courier_id=c and x.status not in ('entregue','cancelada') and (x.store_id is distinct from s or x.source is distinct from 'ifood' or o.source is distinct from 'ifood' or x.logistics_provider is distinct from 'loja')) then raise exception 'Rota exige integração específica' using errcode='42501';end if;
 end if;
 if a='assign' then
  if expected is not null or c is null then raise exception 'Seleção inválida' using errcode='22023';end if;
  return public.assign_order_courier(did,c,confirmed);
 end if;
 if (a in ('remove','reassign') and expected is null) or (a='resume' and expected is not null) or (a='reassign' and c is null) or (a in ('remove','resume') and c is not null) then raise exception 'Seleção inválida' using errcode='22023';end if;
 return public.pitacco_manage_own_delivery(did,expected,c,a,confirmed);
end $fn$;
revoke all on function core_auth.ifood_delivery_fixture(uuid,uuid,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function core_auth.ifood_delivery_fixture(uuid,uuid,text,uuid,uuid,boolean) to pitacco_core_merchant_dispatch;

-- CI only: atomic manual mixed grouping. No departure/provider command.
-- Start from an empty courier route until mixed departure is migrated.
create function core_auth.mixed_dispatch_fixture(s uuid,c uuid,ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $fn$
begin
 if not core_auth.can_act(s) then raise exception 'Sem permissão' using errcode='42501';end if;
 if ids is null or cardinality(ids)<2 or cardinality(ids)>15 or cardinality(ids)<>(select count(distinct u) from unnest(ids) u) then raise exception 'Seleção inválida' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 if not exists(select 1 from public.couriers x where x.id=c and x.store_id=s and x.fleet_type='propria' and x.active) then raise exception 'Entregador não autorizado' using errcode='42501';end if;
 if cardinality(ids)<>(select count(*) from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.id=any(ids) and d.store_id=s and d.source in ('proprio','ifood') and o.source=d.source and d.logistics_provider='loja') then raise exception 'Entrega não autorizada' using errcode='42501';end if;
 -- Lock rows and orders before validating the provider state, in deterministic order.
 perform 1 from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.id=any(ids) order by d.id for update of d,o;
 if (select count(distinct d.source) from public.deliveries d where d.id=any(ids))<>2 then raise exception 'Selecione pedidos próprios e iFood' using errcode='22023';end if;
 if exists(select 1 from public.deliveries d where d.courier_id=c and d.status not in ('entregue','cancelada')) then raise exception 'Entregador já possui rota aberta' using errcode='22023';end if;
 if exists(select 1 from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id where d.id=any(ids) and (
  d.status<>'pendente' or d.courier_id is not null or d.batch_id is not null or d.collected_at is not null or d.capacity_released_at is not null
  or o.status<>'accepted' or o.preparation_status<>'ready'
  or coalesce(d.external_delivery_status,'') in ('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN')
  or (d.source='ifood' and (coalesce(o.receipt->>'ifood_status','') not in ('CONFIRMED','READY_TO_PICKUP') or coalesce(o.receipt->>'ifood_manual_cancel','')='requested' or exists(select 1 from pitacco_private.ifood_courier_dispatch x where x.delivery_id=d.id and x.state in ('claimed','submitted','uncertain'))))
 )) then raise exception 'Pedido indisponível para agrupamento' using errcode='22023';end if;
 return public.assign_delivery_batch(s,c,ids);
end $fn$;
revoke all on function core_auth.mixed_dispatch_fixture(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function core_auth.mixed_dispatch_fixture(uuid,uuid,uuid[]) to pitacco_core_merchant_dispatch;
