create index pitacco_dashboard_order_day on public.orders(created_at)
  where status <> 'historical';
create index pitacco_dashboard_open_orders on public.orders(store_id)
  where status in ('pending','accepted') and preparation_status <> 'completed';

create function public.pitacco_owner_platform_dashboard(p_search text default '',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  current_time_br timestamp := now() at time zone 'America/Sao_Paulo';
  today timestamptz := date_trunc('day',current_time_br) at time zone 'America/Sao_Paulo';
  tomorrow timestamptz := (date_trunc('day',current_time_br)+interval '1 day') at time zone 'America/Sao_Paulo';
  search text := lower(btrim(coalesce(p_search,'')));
  page_size constant integer := 15;
  snapshot jsonb;
begin
  if not public.pitacco_is_platform_owner() then
    raise exception 'Acesso exclusivo do proprietário do Pitacco' using errcode='42501';
  end if;
  if p_page is null or p_page not between 0 and 100000 or length(search)>120 then
    raise exception 'Filtro do painel inválido';
  end if;

  with today_counts as (
    select o.store_id,o.source,count(*) as orders
    from public.orders o
    where o.created_at>=today and o.created_at<tomorrow and o.status<>'historical'
    group by o.store_id,o.source
  ),
  today_by_store as (
    select store_id,sum(orders) as orders from today_counts group by store_id
  ),
  open_counts as (
    select o.store_id,
      count(*) filter(where o.status='pending' and coalesce(o.scheduled_release_at<=now(),true)) as pending,
      count(*) filter(where o.status='pending' and o.scheduled_release_at>now()) as scheduled,
      count(*) filter(where o.status='accepted' and stage.name='preparing') as preparing,
      count(*) filter(where o.status='accepted' and stage.name='ready') as ready,
      count(*) filter(where o.status='accepted' and stage.name='delivering') as delivering
    from public.orders o
    left join public.deliveries d on d.order_id=o.id and d.store_id=o.store_id
    cross join lateral (select case
      when d.status='retirada' or o.receipt->>'ifood_status'='DISPATCHED' then 'delivering'
      when o.preparation_status='ready' then 'ready'
      else 'preparing' end as name) stage
    where o.status in ('pending','accepted') and o.preparation_status<>'completed'
      and (d.status is null or d.status not in ('cancelada','entregue'))
    group by o.store_id
  ),
  courier_counts as (
    select c.store_id,
      count(*) as registered,count(*) filter(where c.active) as active
    from public.couriers c group by c.store_id
  ),
  active_deliveries as (
    select d.store_id,count(*) as deliveries
    from public.deliveries d where d.status in ('pendente','atribuida','aceita','retirada')
    group by d.store_id
  ),
  matching_stores as (
    select s.id,s.name from public.stores s where search='' or strpos(lower(s.name),search)>0
  ),
  store_page as (
    select s.id,s.name,coalesce(t.orders,0) as orders_today,
      coalesce(o.pending+o.preparing+o.ready+o.delivering,0) as orders_in_progress,
      coalesce(o.scheduled,0) as scheduled,
      coalesce(c.registered,0) as couriers,
      coalesce(d.deliveries,0) as deliveries_in_progress,
      billing.status as subscription
    from (select * from matching_stores order by lower(name),id
          limit page_size offset p_page*page_size) s
    left join today_by_store t on t.store_id=s.id
    left join open_counts o on o.store_id=s.id
    left join courier_counts c on c.store_id=s.id
    left join active_deliveries d on d.store_id=s.id
    cross join lateral pitacco_private.subscription_state(s.id) billing
  )
  select jsonb_build_object(
    'updated_at',now(),
    'billing',public.pitacco_subscription_overview(),
    'orders_today',(select coalesce(sum(orders),0) from today_counts),
    'orders',(select jsonb_build_object(
      'pending',coalesce(sum(pending),0),'preparing',coalesce(sum(preparing),0),
      'ready',coalesce(sum(ready),0),'delivering',coalesce(sum(delivering),0),
      'scheduled',coalesce(sum(scheduled),0),
      'in_progress',coalesce(sum(pending+preparing+ready+delivering),0)) from open_counts),
    'channels',(select coalesce(jsonb_object_agg(source,orders),'{}'::jsonb)
                from (select source,sum(orders) as orders from today_counts group by source) channels),
    'couriers',(select jsonb_build_object('registered',coalesce(sum(registered),0),
      'active',coalesce(sum(active),0),
      'shared',coalesce(sum(registered) filter(where store_id is null),0))
      from courier_counts),
    'deliveries_in_progress',(select coalesce(sum(deliveries),0) from active_deliveries),
    'matching_stores',(select count(*) from matching_stores),
    'page_size',page_size,
    'stores',(select coalesce(jsonb_agg(to_jsonb(p) order by lower(p.name),p.id),'[]'::jsonb) from store_page p)
  ) into snapshot;
  return snapshot;
end $$;

revoke all on function public.pitacco_owner_platform_dashboard(text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_owner_platform_dashboard(text,integer) to authenticated;
