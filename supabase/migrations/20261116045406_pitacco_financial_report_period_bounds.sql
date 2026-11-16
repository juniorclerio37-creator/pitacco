-- Qualify period bounds because courier payout rows also have period_start and period_end columns.
create or replace function public.pitacco_period_financial_report(p_store uuid, p_start date, p_end date)
returns table (metric text, channel text, amount numeric, entries bigint)
language plpgsql stable security definer set search_path = '' as $function$
<<report_bounds>>
declare
  period_start timestamptz;
  period_end timestamptz;
begin
  if auth.uid() is null or not public.is_store_manager(p_store) then
    raise exception 'Sem permissão para consultar os relatórios desta loja';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365 then
    raise exception 'Informe um período de até 366 dias';
  end if;
  period_start := p_start::timestamp at time zone 'America/Sao_Paulo';
  period_end := (p_end+1)::timestamp at time zone 'America/Sao_Paulo';

  return query
    select 'vendas'::text, sales.channel, sum(sales.gross), count(*)
      from public.orders sales where sales.store_id=p_store and sales.status in ('accepted','historical')
      and sales.created_at>=report_bounds.period_start and sales.created_at<report_bounds.period_end group by sales.channel
    union all
    select 'taxas'::text, sales.channel, sum(sales.fees), count(*)
      from public.orders sales where sales.store_id=p_store and sales.status in ('accepted','historical')
      and sales.created_at>=report_bounds.period_start and sales.created_at<report_bounds.period_end group by sales.channel
    union all
    select 'pedidos_pendentes'::text, sales.channel, sum(sales.gross), count(*)
      from public.orders sales where sales.store_id=p_store and sales.status='pending'
      and sales.created_at>=report_bounds.period_start and sales.created_at<report_bounds.period_end group by sales.channel
    union all
    select 'recebimentos'::text, null::text, coalesce(sum(receipt.amount),0), count(*)
      from public.store_payment_receipts receipt where receipt.store_id=p_store
      and receipt.recorded_at>=report_bounds.period_start and receipt.recorded_at<report_bounds.period_end
    union all
    select 'despesas'::text, null::text, coalesce(sum(expense.amount),0), count(*)
      from public.expenses expense where expense.store_id=p_store
      and expense.created_at>=report_bounds.period_start and expense.created_at<report_bounds.period_end
    union all
    select 'acertos_entregadores'::text, null::text, coalesce(sum(payout.amount),0), count(*)
      from public.pitacco_courier_payouts payout where payout.store_id=p_store
      and payout.created_at>=report_bounds.period_start and payout.created_at<report_bounds.period_end;
end;
$function$;
