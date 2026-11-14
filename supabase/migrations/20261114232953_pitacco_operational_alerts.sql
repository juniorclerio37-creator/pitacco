create function public.pitacco_operational_alerts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_store_manager(p_store) then
    raise exception 'Sem permissão para consultar alertas desta loja';
  end if;
  with preparation as (
    select coalesce((select preparation_minutes from public.public_menu_settings where store_id=p_store),30) as minutes
  ), orders as (
    select o.id,o.status,o.preparation_status,o.created_at,o.accepted_at,o.scheduled_for,o.scheduled_release_at,
      coalesce(o.receipt->>'display_number',o.receipt->>'external_order_number',left(o.id::text,8)) as reference,
      o.receipt->>'payment_status' as payment_status
    from public.orders o where o.store_id=p_store
      and (o.status in ('pending','accepted') or o.created_at >= now()-interval '48 hours')
  ), courier_summary as (
    select count(*) filter (where c.available) as available,
      count(*) filter (where not c.available) as unavailable,
      count(*) filter (where c.available and p.observed_at between now()-interval '90 seconds' and now()) as recent_gps
    from public.couriers c left join public.courier_positions p on p.courier_id=c.id
    where c.store_id=p_store and c.active
  ), events as (
    select case when coalesce(o.scheduled_release_at,o.created_at)<now()-interval '10 minutes'
                then 'acceptance_late' else 'awaiting_acceptance' end as code,
      o.id as entity_id, o.reference, coalesce(o.scheduled_release_at,o.created_at) as event_at,
      'Pedidos'::text as target, (case when coalesce(o.scheduled_release_at,o.created_at)<now()-interval '10 minutes' then 1 else 2 end) as priority
    from orders o where o.status='pending' and coalesce(o.scheduled_release_at,o.created_at)<=now()
    union all
    select 'preparation_late',o.id,o.reference,least(o.scheduled_for,coalesce(o.accepted_at,o.created_at)+make_interval(mins=>p.minutes)),'Pedidos',1
    from orders o cross join preparation p
    where o.status='accepted' and o.preparation_status='preparing'
      and least(o.scheduled_for,coalesce(o.accepted_at,o.created_at)+make_interval(mins=>p.minutes))<now()
    union all
    select case o.status when 'rejected' then 'order_rejected' else 'order_cancelled' end,
      o.id,o.reference,coalesce(a.created_at,o.created_at),'Pedidos',3
    from orders o
    left join lateral (select max(a.created_at) as created_at from public.operation_audit a
      where a.store_id=p_store and a.order_id=o.id and a.action in ('order_rejected','order_cancelled')) a on true
    where o.status in ('cancelled','rejected') and coalesce(a.created_at,o.created_at)>=now()-interval '48 hours'
    union all
    select case d.status when 'cancelada' then 'delivery_cancelled' else 'delivery_late' end,
      d.id,o.reference,case d.status when 'cancelada' then d.updated_at else d.deliver_by end,'Entregadores',1
    from public.deliveries d left join orders o on o.id=d.order_id
    where d.store_id=p_store and (
      (d.status='cancelada' and d.updated_at>=now()-interval '48 hours') or
      (d.status not in ('cancelada','entregue') and d.deliver_by<now())
    )
    union all
    select 'delivery_partner_failed',r.id,r.provider,r.created_at,'Entregadores',1
    from public.external_delivery_requests r
    where r.store_id=p_store and r.status='falhou' and r.created_at>=now()-interval '48 hours'
    union all
    select 'acceptance_partner_failed',r.id,concat_ws(' · ',r.source,o.reference),coalesce(r.confirmed_at,r.created_at),'Pedidos',1
    from public.marketplace_acceptance_requests r left join orders o on o.id=r.order_id
    where r.store_id=p_store and r.state='rejected' and coalesce(r.confirmed_at,r.created_at)>=now()-interval '48 hours'
    union all
    select 'payment_failed',o.id,o.reference,o.created_at,'Pedidos',1
    from orders o where o.payment_status in ('failed','falhou') and o.created_at>=now()-interval '48 hours'
    union all
    select 'no_courier',p_store,null,now(),'Entregadores',1
    from courier_summary c where c.available=0 and exists (
      select 1 from public.deliveries d where d.store_id=p_store and d.status='pendente' and d.logistics_provider='loja'
    )
  )
  select jsonb_build_object(
    'couriers',(select to_jsonb(summary) from courier_summary summary),
    'events',coalesce((select jsonb_agg(to_jsonb(event) order by event.priority,event.event_at desc,event.entity_id,event.code)
      from (select * from events order by priority,event_at desc,entity_id,code limit 75) event),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;
revoke all on function public.pitacco_operational_alerts(uuid) from public, anon;
grant execute on function public.pitacco_operational_alerts(uuid) to authenticated;
