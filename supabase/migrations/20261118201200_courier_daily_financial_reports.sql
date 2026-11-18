-- One shared ledger for merchant and courier: completed deliveries plus
-- one daily allowance per workday, never cancelled orders.
-- These are exact function definitions carried forward from the live schema,
-- with narrow changes to incorporate the existing daily ledger.
CREATE OR REPLACE FUNCTION public.pitacco_driver_earnings(p_period text DEFAULT 'semana'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_courier uuid;
  v_store uuid;
  v_today date := (pg_catalog.now() at time zone 'America/Sao_Paulo')::date;
  v_week date;
  v_month date;
  v_start date;
  v_min date;
  v_out jsonb;
begin
  if p_period not in ('hoje','semana','mes') then
    raise exception 'Período não permitido' using errcode = '22023';
  end if;

  if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
    raise exception 'Sessão do entregador não autorizada' using errcode = '42501';
  end if;

  select c.id, c.store_id into v_courier, v_store
    from public.couriers c
   where c.user_id = (select auth.uid())
     and c.active = true and c.store_id is not null
   limit 1;
  if v_courier is null then
    raise exception 'Entregador não encontrado ou desativado' using errcode = '42501';
  end if;

  v_week := v_today - (extract(isodow from v_today)::integer - 1);
  v_month := pg_catalog.date_trunc('month', v_today::timestamp)::date;
  v_start := case p_period
    when 'hoje' then v_today
    when 'semana' then v_week
    else v_month end;
  v_min := least(v_week, v_month, v_today - 6);

  with done as materialized (
    select d.id, d.order_id, d.updated_at,
           (d.updated_at at time zone 'America/Sao_Paulo')::date as dia,
           d.courier_payment as valor,
           public.pitacco_order_public_label(o.receipt,coalesce(o.source,d.source)) as public_number
      from public.deliveries d
      left join public.orders o on o.id=d.order_id and o.store_id=d.store_id
     where d.courier_id = v_courier
       and (d.store_id = v_store or public.pitacco_courier_test_access(v_courier,d.store_id))
       and d.status = 'entregue'
       and d.logistics_provider = 'loja'
       and d.updated_at >= (v_min::timestamp at time zone 'America/Sao_Paulo')
       and d.updated_at <= pg_catalog.now()
  ),
  allowances as materialized (
    select a.work_date as dia,a.amount as valor
    from public.pitacco_courier_daily_allowances a
    where a.courier_id=v_courier
      and (a.store_id=v_store or public.pitacco_courier_test_access(v_courier,a.store_id))
      and a.work_date between v_min and v_today
  ),
  daily as (
    select dia,pg_catalog.sum(valor) as total,pg_catalog.sum(qtd) as qtd
    from (
      select dia,valor,1::bigint as qtd from done
      union all
      select dia,valor,0::bigint as qtd from allowances
    ) combined group by dia
  )
  select pg_catalog.jsonb_build_object(
    'period', p_period,
    'timezone', 'America/Sao_Paulo',
    'today', pg_catalog.jsonb_build_object(
      'amount', coalesce((select sum(total) from daily where dia=v_today),0),
      'daily_allowance', coalesce((select sum(valor) from allowances where dia=v_today),0),
      'count', (select count(*) from done where dia=v_today)
    ),
    'week', pg_catalog.jsonb_build_object(
      'amount', coalesce((select sum(total) from daily where dia between v_week and v_today),0),
      'daily_allowance', coalesce((select sum(valor) from allowances where dia between v_week and v_today),0),
      'count', (select count(*) from done where dia between v_week and v_today)
    ),
    'month', pg_catalog.jsonb_build_object(
      'amount', coalesce((select sum(total) from daily where dia between v_month and v_today),0),
      'daily_allowance', coalesce((select sum(valor) from allowances where dia between v_month and v_today),0),
      'count', (select count(*) from done where dia between v_month and v_today)
    ),
    'week_chart', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'date', g.dia::date,
          'amount', coalesce(daily.total,0),
          'count', coalesce(daily.qtd,0)
        ) order by g.dia), '[]'::jsonb)
      from pg_catalog.generate_series(v_week::timestamp,(v_week+6)::timestamp,
            interval '1 day') as g(dia)
      left join daily on daily.dia = g.dia::date
    ),
    'worked_days', (
      select count(distinct dia) from done where dia between v_start and v_today
    ),
    'period_start', v_start,
    'period_end', v_today,
    'day_breakdown', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'date', daily.dia,
          'amount', daily.total,
          'count', daily.qtd
        ) order by daily.dia desc), '[]'::jsonb)
      from daily where daily.dia between v_start and v_today
    ),
    'recent', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'public_number', r.public_number,
          'completed_at', r.updated_at,
          'amount', r.valor
        ) order by r.updated_at desc), '[]'::jsonb)
      from (
        select id,public_number,updated_at,valor from done
         where dia between v_start and v_today
         order by updated_at desc limit 20
      ) r
    )
  ) into v_out;
  return v_out;
end
$function$
;
CREATE OR REPLACE FUNCTION public.pitacco_courier_statement(p_store uuid, p_start date, p_end date)
 RETURNS TABLE(courier_id uuid, courier_name text, completed_deliveries bigint, delivery_earnings numeric, daily_allowances numeric, payments_recorded numeric, delivery_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin if not public.is_store_manager(p_store) then raise exception 'Sem permissão'; end if; if p_start is null or p_end is null or p_end<p_start or p_end>p_start+interval '366 days' then raise exception 'Período inválido (máximo 366 dias)'; end if; return query select c.id,c.name,coalesce(d.qty,0),coalesce(d.earned,0),coalesce(a.allowance,0),coalesce(p.paid,0),coalesce(d.earned,0)+coalesce(a.allowance,0)-coalesce(p.paid,0) from public.couriers c left join lateral(select count(*) qty,coalesce(sum(x.courier_payment),0) earned from public.deliveries x where x.store_id=p_store and x.courier_id=c.id and x.status='entregue' and (x.updated_at at time zone 'America/Sao_Paulo')::date between p_start and p_end) d on true left join lateral(select coalesce(sum(x.amount),0) allowance from public.pitacco_courier_daily_allowances x where x.store_id=p_store and x.courier_id=c.id and x.work_date between p_start and p_end) a on true left join lateral(select coalesce(sum(x.amount),0) paid from public.pitacco_courier_payouts x where x.store_id=p_store and x.courier_id=c.id and x.period_start>=p_start and x.period_end<=p_end) p on true where c.store_id=p_store order by c.name;end $function$
;
CREATE OR REPLACE FUNCTION public.pitacco_register_courier_payout(p_store uuid, p_courier uuid, p_start date, p_end date, p_amount numeric, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_due numeric;
begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_amount is null or p_amount<=0 then raise exception 'Pagamento invalido'; end if;
 if not exists(select 1 from public.couriers where id=p_courier and store_id=p_store) then raise exception 'Entregador nao pertence a loja'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||p_courier::text,0));
 if exists(select 1 from public.pitacco_courier_payouts p where p.store_id=p_store and p.courier_id=p_courier and daterange(p.period_start,p.period_end,'[]') && daterange(p_start,p_end,'[]') and (p.period_start<>p_start or p.period_end<>p_end)) then raise exception 'Periodo sobreposto: conclua o acerto anterior antes de mudar o intervalo'; end if;
 select coalesce(sum(d.courier_payment),0) into v_due from public.deliveries d
 where d.store_id=p_store and d.courier_id=p_courier and d.status='entregue'
 and (d.updated_at at time zone 'America/Sao_Paulo')::date between p_start and p_end;
 v_due:=v_due+(select coalesce(sum(amount),0) from public.pitacco_courier_daily_allowances
  where store_id=p_store and courier_id=p_courier and work_date between p_start and p_end);
 v_due:=v_due-(select coalesce(sum(amount),0) from public.pitacco_courier_payouts where store_id=p_store and courier_id=p_courier and period_start>=p_start and period_end<=p_end);
 if round(p_amount,2)>round(v_due,2) then raise exception 'Pagamento excede saldo do periodo'; end if;
 insert into public.pitacco_courier_payouts(store_id,courier_id,period_start,period_end,amount,note)
 values(p_store,p_courier,p_start,p_end,round(p_amount,2),left(coalesce(p_note,''),500)) returning id into v_id;
 return v_id;
end $function$
;
