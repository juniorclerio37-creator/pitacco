-- Pitacco Entregador: ganhos baseados em entregas concluídas e repasse registrado.
-- Fonte idêntica à usada em CourierFinance.jsx / pitacco_register_courier_payout:
-- deliveries.courier_payment e data de conclusão = updated_at, em America/Sao_Paulo.
-- SECURITY INVOKER + RLS: não permite consultar entregas de outro motoboy.
create or replace function public.pitacco_driver_earnings(p_period text default 'semana')
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
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
           d.courier_payment as valor
      from public.deliveries d
     where d.courier_id = v_courier
       and d.store_id = v_store
       and d.status = 'entregue'
       and d.logistics_provider = 'loja'
       and d.updated_at >= (v_min::timestamp at time zone 'America/Sao_Paulo')
       and d.updated_at <= pg_catalog.now()
  ),
  daily as (
    select dia, pg_catalog.sum(valor) as total, pg_catalog.count(*) as qtd
      from done group by dia
  )
  select pg_catalog.jsonb_build_object(
    'period', p_period,
    'timezone', 'America/Sao_Paulo',
    'today', pg_catalog.jsonb_build_object(
      'amount', coalesce((select sum(valor) from done where dia=v_today),0),
      'count', (select count(*) from done where dia=v_today)
    ),
    'week', pg_catalog.jsonb_build_object(
      'amount', coalesce((select sum(valor) from done where dia between v_week and v_today),0),
      'count', (select count(*) from done where dia between v_week and v_today)
    ),
    'month', pg_catalog.jsonb_build_object(
      'amount', coalesce((select sum(valor) from done where dia between v_month and v_today),0),
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
    'recent', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'delivery_id', r.id,
          'order_id', r.order_id,
          'completed_at', r.updated_at,
          'amount', r.valor
        ) order by r.updated_at desc), '[]'::jsonb)
      from (
        select id,order_id,updated_at,valor from done
         where dia between v_start and v_today
         order by updated_at desc limit 20
      ) r
    )
  ) into v_out;
  return v_out;
end
$function$;

revoke all on function public.pitacco_driver_earnings(text) from public, anon;
grant execute on function public.pitacco_driver_earnings(text) to authenticated;

create index if not exists pitacco_driver_earnings_deliveries_idx
  on public.deliveries (courier_id,store_id,updated_at desc)
  include (courier_payment,order_id)
  where status='entregue' and logistics_provider='loja';
