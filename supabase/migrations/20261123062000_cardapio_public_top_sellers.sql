-- Somente IDs de produtos do catálogo público; sem dados pessoais nem total vendido.
-- Usa os itens de pedidos aceitos/concluídos nos últimos 90 dias, de todos os canais.
create or replace function public.pitacco_public_top_sellers(p_slug text)
returns uuid[] language sql stable security definer set search_path='' as $$
  with shop as (
    select m.store_id from public.public_menu_settings m
     where m.slug=p_slug and m.enabled limit 1
  ), sold as (
    select lower(btrim(item.obj->>'name')) as product_name,
           sum(case when item.obj->>'quantity' ~ '^[0-9]{1,5}$'
                    then (item.obj->>'quantity')::int else 0 end) as units
      from public.orders o
      join shop on shop.store_id=o.store_id
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(o.receipt->'items')='array'
             then o.receipt->'items' else '[]'::jsonb end
      ) item(obj)
     where o.created_at>=now()-interval '90 days'
       and o.status not in ('cancelled','rejected','failed')
       and jsonb_typeof(item.obj)='object'
     group by 1
  ), ranked as (
     select p.id,sold.units
       from public.products p
       join shop on shop.store_id=p.store_id
       join sold on sold.product_name=lower(btrim(p.name))
      where p.menu_active and sold.units>0
      order by sold.units desc,p.name,p.id limit 2
  )
  select coalesce(array_agg(id order by units desc,id),'{}'::uuid[]) from ranked;
$$;
revoke all on function public.pitacco_public_top_sellers(text) from public,anon,authenticated;
grant execute on function public.pitacco_public_top_sellers(text) to anon,authenticated;