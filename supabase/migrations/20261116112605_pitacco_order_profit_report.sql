create function public.pitacco_order_profit_report(p_store uuid,p_start date,p_end date,p_page integer default 0)
returns table(order_id uuid,reference text,created_at timestamptz,channel text,gross numeric,fees numeric,
  goods_cost numeric,processing_fees numeric,delivery_cost numeric,other_cost numeric,merchant_discount numeric,
  direct_cost numeric,result numeric)
language plpgsql stable security definer set search_path='' as $function$
<<report>>
declare
  from_time timestamptz := p_start::timestamp at time zone 'America/Sao_Paulo';
  until_time timestamptz := (p_end+1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if auth.uid() is null or not public.is_store_manager(p_store) then
    raise exception 'Sem permissão para consultar os pedidos desta loja';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end-p_start > 365
     or p_page is null or p_page not between 0 and 10000 then
    raise exception 'Informe um período de até 366 dias';
  end if;

  return query
  select o.id,coalesce(o.receipt->>'display_number',o.receipt->>'external_order_number',left(o.id::text,8)),
    o.created_at,o.channel,o.gross,coalesce(o.fees,0),c.goods_cost,c.processing_fees,c.delivery_cost,
    c.other_cost,c.merchant_discount,amount.direct,o.gross-coalesce(o.fees,0)-amount.direct
  from public.orders o
  left join public.pitacco_order_costs c on c.order_id=o.id and c.store_id=o.store_id
  cross join lateral (select c.goods_cost+c.processing_fees+c.delivery_cost+c.other_cost as direct) amount
  where o.store_id=p_store and o.status in ('accepted','historical')
    and o.created_at>=report.from_time and o.created_at<report.until_time
  order by o.created_at desc,o.id desc offset p_page*25 limit 26;
end;
$function$;
revoke all on function public.pitacco_order_profit_report(uuid,date,date,integer) from public,anon;
grant execute on function public.pitacco_order_profit_report(uuid,date,date,integer) to authenticated;
