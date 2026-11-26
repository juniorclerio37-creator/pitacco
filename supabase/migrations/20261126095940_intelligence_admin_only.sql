-- Consultative, store-scoped business signals; no writes or model access.
create or replace function public.pitacco_business_insights(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $insights$
declare
 today date:=(now() at time zone 'America/Sao_Paulo')::date;
 since_at timestamptz:=(today-28)::timestamp at time zone 'America/Sao_Paulo';
 until_at timestamptz:=today::timestamp at time zone 'America/Sao_Paulo';
 sales jsonb; stock jsonb; weekdays jsonb; catalog jsonb; pairs jsonb; identified_orders bigint;
begin
 if auth.uid() is null or p_store is null or not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do Super Admin' using errcode='42501';
 end if;
 if not exists(select 1 from public.stores where id=p_store) then raise exception 'Loja inexistente'; end if;
 with amounts as (
 select o.gross, o.gross-coalesce(o.fees,0)-coalesce(c.goods_cost,m.calculated_cost)-c.processing_fees-c.delivery_cost-c.other_cost as contribution
 from public.orders o
 left join public.pitacco_order_costs c on c.order_id=o.id and c.store_id=o.store_id
 left join public.pitacco_order_material_cost_summary m on m.order_id=o.id and m.store_id=o.store_id
 where o.store_id=p_store and o.status in ('accepted','historical') and o.created_at>=since_at and o.created_at<until_at
 )
 select jsonb_build_object('orders',count(*),'gross',coalesce(sum(gross),0),'complete_costs',count(contribution),
 'negative_orders',count(*) filter(where contribution<0),'known_contribution',sum(contribution)) into sales from amounts;
 with usage as (
 select ingredient_id, sum(-quantity)/28 as daily_usage, count(distinct (created_at at time zone 'America/Sao_Paulo')::date) as usage_days
 from public.pitacco_stock_movements where store_id=p_store and order_id is not null and quantity<0 and created_at>=since_at and created_at<until_at group by ingredient_id
 ), candidates as (
 select i.name,i.unit,i.balance,i.minimum,round(u.daily_usage,3) as daily_usage,
 case when u.usage_days>=7 and u.daily_usage>0 then round(greatest(i.balance,0)/u.daily_usage,1) end as days_left
 from public.pitacco_ingredients i left join usage u on u.ingredient_id=i.id where i.store_id=p_store
 ), alerts as (
 select * from candidates where balance<=minimum or days_left<=2
 order by (balance<=minimum) desc,days_left asc nulls last,name limit 20
 ) select coalesce(jsonb_agg(to_jsonb(alerts)),'[]'::jsonb) into stock from alerts;
 with days as (
 select d::date as day from generate_series((today-28)::timestamp,(today-1)::timestamp,interval '1 day') d
 ), counts as (
 select (created_at at time zone 'America/Sao_Paulo')::date as day,count(*) as orders
 from public.orders where store_id=p_store and status in ('accepted','historical') and created_at>=since_at and created_at<until_at group by 1
 ), by_weekday as (
 select extract(isodow from days.day)::int as weekday,sum(coalesce(counts.orders,0)) as orders,
 round(avg(coalesce(counts.orders,0)),1) as average_orders from days left join counts using(day) group by 1
 ) select jsonb_agg(to_jsonb(by_weekday) order by weekday) into weekdays from by_weekday;

 -- Catalog evidence: active simple products only, excluding fixed combos, pizzas,
 -- out-of-stock finished products and products with mandatory selections.
 with eligible as (
 select p.id,p.name,p.category,p.price,case when p.cost>0 then p.cost end as recorded_cost
 from public.products p
 left join public.pitacco_finished_product_stock fs on fs.product_id=p.id and fs.store_id=p.store_id
 where p.store_id=p_store and p.menu_active and p.price>0
 and not (coalesce(fs.enabled,false) and fs.balance<1)
 and not exists(select 1 from public.product_option_groups g where g.store_id=p_store and g.product_id=p.id and g.enabled and g.min_select>0)
 and not exists(select 1 from pitacco_private.pizza_catalog pc where pc.store_id=p_store and pc.product_id=p.id)
 and not exists(select 1 from pitacco_private.combo_catalog cc where cc.store_id=p_store and cc.product_id=p.id)
 ), lines as (
 select distinct o.id as order_id,e.id as product_id
 from public.orders o
 cross join lateral jsonb_array_elements(case when jsonb_typeof(o.receipt->'items')='array' then o.receipt->'items' else '[]'::jsonb end) item
 join eligible e on e.id::text=item->>'product_id'
 where o.store_id=p_store and o.status in ('accepted','historical') and o.created_at>=since_at and o.created_at<until_at
 ), popularity as (
 select e.*,count(l.order_id) as orders from eligible e left join lines l on l.product_id=e.id group by e.id,e.name,e.category,e.price,e.recorded_cost
 ), top_products as (
 select * from popularity order by orders desc,name,id limit 30
 ), pair_counts as (
 select a.product_id as first_id,b.product_id as second_id,count(*) as orders
 from lines a join lines b on a.order_id=b.order_id and a.product_id<b.product_id
 group by 1,2 having count(*)>=3
 ), ranked_pairs as (
 select jsonb_build_object('first',to_jsonb(a),'second',to_jsonb(b),'together_orders',pc.orders) as pair,pc.orders,a.name as first_name,b.name as second_name
 from pair_counts pc join popularity a on a.id=pc.first_id join popularity b on b.id=pc.second_id
 order by pc.orders desc,a.name,b.name limit 8
 )
 select coalesce((select jsonb_agg(to_jsonb(t) order by t.orders desc,t.name,t.id) from top_products t),'[]'::jsonb),
 coalesce((select jsonb_agg(r.pair order by r.orders desc,r.first_name,r.second_name) from ranked_pairs r),'[]'::jsonb),
 (select count(distinct order_id) from lines)
 into catalog,pairs,identified_orders;
 return jsonb_build_object('observed_at',now(),'period_start',today-28,'period_end',today-1,'sales',sales,'stock_alerts',stock,'weekdays',weekdays,'catalog',catalog,'combo_candidates',pairs,'identified_orders',identified_orders);
end $insights$;
revoke all on function public.pitacco_business_insights(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_business_insights(uuid) to authenticated;
notify pgrst,'reload schema';
