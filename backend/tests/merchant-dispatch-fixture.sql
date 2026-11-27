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
