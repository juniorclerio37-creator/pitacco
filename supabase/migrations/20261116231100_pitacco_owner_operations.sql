
create function public.pitacco_owner_operation_rows(
 p_kind text,p_store uuid default null,p_start date default null,p_end date default null,
 p_source text default null,p_status text default null,p_min numeric default null,p_max numeric default null,
 p_delivery text default null,p_page integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
  first_day date := coalesce(p_start,local_day-6);
  last_day date := coalesce(p_end,local_day);
  starts timestamptz;
  ends timestamptz;
  j jsonb;
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário do Pitacco' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('orders','couriers','audit') or p_page is null or p_page not between 0 and 100000
    or first_day>last_day or last_day-first_day>366
    or coalesce(p_min,0)<0 or (p_max is not null and p_max<coalesce(p_min,0)) then
  raise exception 'Confira o período e os filtros';
 end if;
 starts:=first_day::timestamp at time zone 'America/Sao_Paulo';
 ends:=(last_day+1)::timestamp at time zone 'America/Sao_Paulo';
 if p_kind='orders' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into j from (
   select o.id,o.store_id,s.name as store_name,coalesce(o.receipt->>'display_number',o.receipt->>'external_order_number',left(o.id::text,8)) as reference,
    o.source,o.created_at,o.gross,stage.status,delivery.kind as delivery
   from public.orders o join public.stores s on s.id=o.store_id
   left join public.deliveries d on d.order_id=o.id and d.store_id=o.store_id
   cross join lateral (select case
    when o.status='rejected' then 'rejected'
    when o.status='cancelled' or d.status='cancelada' then 'cancelled'
    when o.preparation_status='completed' or d.status='entregue' then 'completed'
    when o.status='pending' and o.scheduled_release_at>now() then 'scheduled'
    when d.status='retirada' or o.receipt->>'ifood_status'='DISPATCHED' then 'delivery'
    when o.status='pending' then 'pending'
    when o.preparation_status='ready' then 'ready' else 'preparing' end as status) stage
   cross join lateral (select case when d.logistics_provider='marketplace' or o.receipt->>'logistics'='marketplace' then 'marketplace'
    when o.receipt->>'logistics'='retirada' then 'pickup'
    when d.logistics_provider='loja' or o.receipt->>'logistics'='loja' then 'store'
    else 'unknown' end as kind) delivery
   where o.status<>'historical' and o.created_at>=starts and o.created_at<ends
    and (p_store is null or o.store_id=p_store)
    and (p_source is null or o.source=p_source) and (p_status is null or stage.status=p_status)
    and (p_delivery is null or delivery.kind=p_delivery)
    and (p_min is null or o.gross>=p_min) and (p_max is null or o.gross<=p_max)
   order by o.created_at desc,o.id desc offset p_page*25 limit 26
  ) x;
 elsif p_kind='couriers' then
  select coalesce(jsonb_agg(to_jsonb(x) order by lower(x.name),x.id),'[]'::jsonb) into j from (
   select c.id,c.name,c.store_id,coalesce(s.name,'Frota compartilhada') as store_name,c.active,
    c.active and c.available and coalesce(p.observed_at>=now()-interval '2 minutes',false) as online,
    activity.in_progress,activity.completed
   from public.couriers c left join public.stores s on s.id=c.store_id
   left join public.courier_positions p on p.courier_id=c.id
   cross join lateral (select count(*) filter(where d.status in ('pendente','atribuida','aceita','retirada')) as in_progress,
    count(*) filter(where d.status='entregue') as completed from public.deliveries d where d.courier_id=c.id) activity
   where (p_store is null or c.store_id=p_store)
    and (p_status is null or p_status=case when c.active and c.available and coalesce(p.observed_at>=now()-interval '2 minutes',false) then 'online' else 'offline' end)
   order by lower(c.name),c.id offset p_page*25 limit 26
  ) x;
 else
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into j from (
   select a.id,a.store_id,s.name as store_name,a.action,a.created_at
   from public.operation_audit a join public.stores s on s.id=a.store_id
   where a.created_at>=starts and a.created_at<ends and (p_store is null or a.store_id=p_store)
   order by a.created_at desc,a.id desc offset p_page*25 limit 26
  ) x;
 end if;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25);
end $$;
revoke all on function public.pitacco_owner_operation_rows(text,uuid,date,date,text,text,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_owner_operation_rows(text,uuid,date,date,text,text,numeric,numeric,text,integer) to authenticated;
