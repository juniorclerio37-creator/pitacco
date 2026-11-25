-- Read-only operational board, with day boundary computed in Sao Paulo.
create or replace function public.pitacco_daily_operational_orders(p_store uuid)
returns setof public.orders language sql stable security invoker set search_path='' as $$
 select o.* from public.orders o
 left join public.deliveries d on d.order_id=o.id and d.store_id=o.store_id
 where auth.uid() is not null and public.is_store_manager(p_store)
 and o.store_id=p_store and o.status in ('pending','accepted','cancelled','rejected')
 and (
  o.created_at >= (pg_catalog.timezone('America/Sao_Paulo',now())::date::timestamp at time zone 'America/Sao_Paulo')
  or (o.status in ('pending','accepted') and coalesce(d.status,'') not in ('entregue','cancelada')
      and not (o.source='proprio' and coalesce(o.receipt->>'logistics','')='retirada' and coalesce(o.preparation_status,'')='completed')
      and not (o.source='ifood' and coalesce(o.receipt->>'ifood_status','')='CONCLUDED' and coalesce(d.status,'')<>'retirada'))
 );
$$;
revoke all on function public.pitacco_daily_operational_orders(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_daily_operational_orders(uuid) to authenticated;
notify pgrst,'reload schema';
