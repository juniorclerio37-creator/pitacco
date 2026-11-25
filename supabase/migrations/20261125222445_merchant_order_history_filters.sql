create or replace function public.pitacco_merchant_order_history(p_store uuid,p_from date,p_to date,p_status text default 'all',p_origin text default 'all',p_query text default '',p_offset integer default 0)
returns table(order_data jsonb,delivery_data jsonb,order_stage text,reason text)
language sql stable security invoker set search_path='' as $$
 with rows as (
 select o, d, case
 when o.status='rejected' then 'rejected'
 when o.status='cancelled' or d.status='cancelada' then 'cancelled'
 when d.status='entregue' then 'completed'
 when d.status='retirada' or o.receipt->>'ifood_status'='DISPATCHED' then 'delivery'
 when o.source='ifood' and o.receipt->>'ifood_status'='CONCLUDED' then 'completed'
 when o.preparation_status='completed' then case when o.source='proprio' and o.receipt->>'logistics'='retirada' then 'completed' else 'ready' end
 when o.status='pending' then case when o.scheduled_release_at>now() then 'scheduled' else 'analysis' end
 when o.status='accepted' then case when o.preparation_status='ready' then 'ready' else 'preparing' end
 else 'historical' end as stage,
 case when o.source='proprio' and coalesce(o.receipt->>'point_of_sale','false')='true' then 'balcao' when o.source='proprio' then 'cardapio' else o.source end as origin
 from public.orders o left join public.deliveries d on d.order_id=o.id and d.store_id=o.store_id
 where auth.uid() is not null and public.is_store_manager(p_store) and o.store_id=p_store
 and p_from is not null and p_to>=p_from and p_to-p_from<=366 and p_offset between 0 and 1000000
 and o.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
 and o.created_at < ((p_to+1)::timestamp at time zone 'America/Sao_Paulo')
 and (coalesce(trim(p_query),'')='' or strpos(lower(concat_ws(' ',o.receipt->>'display_number',o.receipt->>'external_order_number',o.receipt->>'order_number',o.receipt->>'display_id',o.receipt->>'number',o.receipt->>'customer',o.receipt->>'phone',o.receipt->>'customer_phone')),lower(left(trim(p_query),100)))>0)
 )
 select to_jsonb(r.o),case when (r.d).id is not null then to_jsonb(r.d) end,r.stage,
 (select left(a.details->>'reason',240) from public.operation_audit a where a.store_id=p_store and a.order_id=(r.o).id and a.action in ('order_cancelled','order_rejected','ifood_manual_cancel_requested') order by a.created_at desc limit 1)
 from rows r
 where (p_status='all' or r.stage=p_status or (p_status='cancelled' and r.stage='rejected'))
 and (p_origin='all' or r.origin=p_origin)
 order by (r.o).created_at desc,(r.o).id desc offset p_offset limit 51;
$$;
revoke all on function public.pitacco_merchant_order_history(uuid,date,date,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_order_history(uuid,date,date,text,text,text,integer) to authenticated;
notify pgrst,'reload schema';
