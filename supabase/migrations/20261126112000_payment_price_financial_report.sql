-- Financial summaries show price adjustments as informational breakdowns.
-- Gross already includes them: do not add or subtract the breakdown again.
do $report$
declare d text:=pg_get_functiondef('public.pitacco_period_financial_report(uuid,date,date)'::regprocedure); anchor text; addition text;
begin
 anchor:=$a$    select 'pedidos_pendentes'::text, sales.channel, sum(sales.gross), count(*)$a$;
 addition:=$a$    select 'acrescimos_pagamento'::text, sales.channel, sum((sales.receipt->'payment_price'->>'adjustment_cents')::numeric)/100, count(*)
      from public.orders sales where sales.store_id=p_store and sales.status in ('accepted','historical') and sales.source='proprio'
      and sales.created_at>=report_bounds.period_start and sales.created_at<report_bounds.period_end
      and jsonb_typeof(sales.receipt->'payment_price'->'adjustment_cents')='number'
      and (sales.receipt->'payment_price'->>'adjustment_cents')::numeric>0 group by sales.channel
    union all
    select 'descontos_pagamento'::text, sales.channel, sum(-(sales.receipt->'payment_price'->>'adjustment_cents')::numeric)/100, count(*)
      from public.orders sales where sales.store_id=p_store and sales.status in ('accepted','historical') and sales.source='proprio'
      and sales.created_at>=report_bounds.period_start and sales.created_at<report_bounds.period_end
      and jsonb_typeof(sales.receipt->'payment_price'->'adjustment_cents')='number'
      and (sales.receipt->'payment_price'->>'adjustment_cents')::numeric<0 group by sales.channel
    union all
$a$;
 if strpos(d,anchor)=0 then raise exception 'Financial report adjustment anchor missing';end if;
 execute replace(d,anchor,addition||anchor);
end $report$;
