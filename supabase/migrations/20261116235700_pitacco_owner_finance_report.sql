
create function public.pitacco_owner_finance_report(p_start date,p_end date,p_store uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 range_start timestamptz;
 range_end timestamptz;
 report jsonb;
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário do Pitacco' using errcode='42501';
 end if;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>365 or p_start<'2000-01-01' or p_end>'2100-01-01' then
  raise exception 'Informe um período válido de até 366 dias' using errcode='22023';
 end if;
 range_start:=p_start::timestamp at time zone 'America/Sao_Paulo';
 range_end:=(p_end+1)::timestamp at time zone 'America/Sao_Paulo';
 with sales as (
  select (o.created_at at time zone 'America/Sao_Paulo')::date as day,
   count(*) as orders, sum(o.gross) as gross
  from public.orders o
  where o.created_at>=range_start and o.created_at<range_end and o.status='accepted'
   and (p_store is null or o.store_id=p_store)
   and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='cancelada')
   and (o.preparation_status='completed' or exists(select 1 from public.deliveries d
     where d.order_id=o.id and d.store_id=o.store_id and d.status='entregue'))
  group by 1
 ), paid as (
  select (p.confirmed_at at time zone 'America/Sao_Paulo')::date as day,
    count(*) as payments, sum(p.amount) as subscriptions
  from pitacco_private.subscription_payments p
  where p.confirmed_at>=range_start and p.confirmed_at<range_end
   and p.provider='asaas' and p.provider_payment_id like 'production:%'
   and (p_store is null or p.store_id=p_store)
  group by 1
 ), calendar as (
  select p_start+n as day,coalesce(s.orders,0) as orders,coalesce(s.gross,0) as gross,
   coalesce(p.payments,0) as payments,coalesce(p.subscriptions,0) as subscriptions
  from generate_series(0,p_end-p_start) as numbers(n)
  left join sales s on s.day=p_start+n left join paid p on p.day=p_start+n
 )
 select jsonb_build_object('days',jsonb_agg(to_jsonb(c) order by day),
  'orders',sum(orders),'gross',sum(gross),'payments',sum(payments),'subscriptions',sum(subscriptions))
 into report from calendar c;
 return report;
end $$;
revoke all on function public.pitacco_owner_finance_report(date,date,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_finance_report(date,date,uuid) to authenticated;
