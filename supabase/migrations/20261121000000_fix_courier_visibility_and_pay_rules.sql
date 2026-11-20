-- Restore authorized shared couriers in merchant screens and allow
-- per-store remuneration ONLY where a courier has explicit test access.
create or replace function public.pitacco_service_store_couriers(
 p_actor uuid, p_store uuid
)
returns setof public.couriers
language plpgsql stable security definer
set search_path to ''
as $fn$
begin
 if not coalesce(public.pitacco_can_manage_courier_store(p_actor,p_store),false) then
  raise exception 'Sem permissão para listar entregadores desta loja'
   using errcode='42501';
 end if;
 return query
 select c.* from public.couriers c
 where c.store_id=p_store
  or (c.active and public.pitacco_courier_test_access(c.id,p_store))
 order by c.name,c.id;
end $fn$;
revoke all on function public.pitacco_service_store_couriers(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.pitacco_service_store_couriers(uuid,uuid)
 to service_role;

create or replace function public.pitacco_validate_courier_pay_rule()
returns trigger language plpgsql
set search_path to ''
as $fn$
begin
 if not exists(
  select 1 from public.couriers c where c.id=new.courier_id
    and (c.store_id=new.store_id or
      (c.active and public.pitacco_courier_test_access(c.id,new.store_id)))
 ) then
  raise exception 'Entregador não pertence nem está autorizado a atender esta loja';
 end if;
 new.updated_at=now();
 return new;
end $fn$;

-- Existing payouts are immutable; enable registration only for work actually
-- completed at the current store by its own or explicitly shared courier.
create or replace function public.pitacco_register_courier_payout(
 p_store uuid,p_courier uuid,p_start date,p_end date,p_amount numeric,
 p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path to ''
as $fn$
declare v_id uuid;v_due numeric;
begin
 if not coalesce(public.is_store_manager(p_store),false) then
  raise exception 'Sem permissão';
 end if;
 if p_start is null or p_end is null or p_end<p_start
   or p_amount is null or p_amount<=0 then
  raise exception 'Pagamento inválido';
 end if;
 if not exists(select 1 from public.couriers c where c.id=p_courier
  and (c.store_id=p_store or
   (c.active and public.pitacco_courier_test_access(c.id,p_store)))) then
  raise exception 'Entregador não vinculado à loja';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(p_store::text||p_courier::text,0)
 );
 if exists(
  select 1 from public.pitacco_courier_payouts p
  where p.store_id=p_store and p.courier_id=p_courier
   and daterange(p.period_start,p.period_end,'[]') &&
       daterange(p_start,p_end,'[]')
   and (p.period_start<>p_start or p.period_end<>p_end)
 ) then
  raise exception 'Período sobreposto: conclua o acerto anterior';
 end if;
 select coalesce(sum(d.courier_payment),0) into v_due
 from public.deliveries d
 where d.store_id=p_store and d.courier_id=p_courier
  and d.status='entregue'
  and (d.updated_at at time zone 'America/Sao_Paulo')::date
   between p_start and p_end;
 v_due:=v_due+(select coalesce(sum(amount),0)
  from public.pitacco_courier_daily_allowances
  where store_id=p_store and courier_id=p_courier
   and work_date between p_start and p_end);
 v_due:=v_due-(select coalesce(sum(amount),0)
  from public.pitacco_courier_payouts
  where store_id=p_store and courier_id=p_courier
   and period_start>=p_start and period_end<=p_end);
 if round(p_amount,2)>round(v_due,2) then
  raise exception 'Pagamento excede saldo do período';
 end if;
 insert into public.pitacco_courier_payouts
  (store_id,courier_id,period_start,period_end,amount,note)
 values(p_store,p_courier,p_start,p_end,round(p_amount,2),
  left(coalesce(p_note,''),500))
 returning id into v_id;
 return v_id;
end $fn$;

create or replace function public.pitacco_courier_statement(
 p_store uuid,p_start date,p_end date
)
returns table(courier_id uuid,courier_name text,
 completed_deliveries bigint,delivery_earnings numeric,
 daily_allowances numeric,payments_recorded numeric,delivery_balance numeric)
language plpgsql stable security definer
set search_path to ''
as $fn$
begin
 if not coalesce(public.is_store_manager(p_store),false) then
  raise exception 'Sem permissão';
 end if;
 if p_start is null or p_end is null or p_end<p_start
   or p_end>p_start+interval '366 days' then
  raise exception 'Período inválido (máximo 366 dias)';
 end if;
 return query select c.id,c.name,coalesce(d.qty,0),
  coalesce(d.earned,0),coalesce(a.allowance,0),coalesce(p.paid,0),
  coalesce(d.earned,0)+coalesce(a.allowance,0)-coalesce(p.paid,0)
 from public.couriers c
 left join lateral(select count(*) qty,coalesce(sum(x.courier_payment),0) earned
  from public.deliveries x
  where x.store_id=p_store and x.courier_id=c.id and x.status='entregue'
   and (x.updated_at at time zone 'America/Sao_Paulo')::date
    between p_start and p_end) d on true
 left join lateral(select coalesce(sum(x.amount),0) allowance
  from public.pitacco_courier_daily_allowances x
  where x.store_id=p_store and x.courier_id=c.id
   and x.work_date between p_start and p_end) a on true
 left join lateral(select coalesce(sum(x.amount),0) paid
  from public.pitacco_courier_payouts x
  where x.store_id=p_store and x.courier_id=c.id
   and x.period_start>=p_start and x.period_end<=p_end) p on true
 where c.store_id=p_store
  or (c.active and public.pitacco_courier_test_access(c.id,p_store))
 order by c.name;
end $fn$;