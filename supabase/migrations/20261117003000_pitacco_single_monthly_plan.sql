
create or replace function public.pitacco_owner_commercial_plans()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário do Pitacco' using errcode='42501';
 end if;
 return jsonb_build_array(jsonb_build_object(
  'code','pitacco','name','Pitacco','monthly_cents',3990,'trial_days',30,
  'commission_basis_points',0,'billing_cycle','monthly',
  'sales_threshold_cents',200000,'above_threshold_monthly_cents',5990
 ));
end $$;

drop function if exists pitacco_private.weekly_commission_period(timestamptz);
drop function if exists pitacco_private.weekly_commission_base(text,boolean,boolean,boolean,bigint,bigint,bigint,bigint);
drop function if exists pitacco_private.weekly_commission_cents(numeric);

create function public.pitacco_owner_monthly_plan_estimate(p_store uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 starts timestamptz;
 ends timestamptz;
 policy jsonb;
 totals jsonb;
 sales_cents bigint;
 threshold bigint;
begin
 policy:=public.pitacco_owner_commercial_plans()->0;
 if p_store is null or p_month is null or extract(day from p_month)<>1
    or p_month<'2000-01-01' or p_month>date_trunc('month',now() at time zone 'America/Sao_Paulo')::date then
  raise exception 'Informe uma loja e um mês válido' using errcode='22023';
 end if;
 if not exists(select 1 from public.stores where id=p_store) then
  raise exception 'Loja não encontrada' using errcode='22023';
 end if;
 starts:=p_month::timestamp at time zone 'America/Sao_Paulo';
 ends:=(p_month+interval '1 month') at time zone 'America/Sao_Paulo';
 threshold:=(policy->>'sales_threshold_cents')::bigint;
 with eligible as (
  select o.source,round(sum(o.gross)*100)::bigint as sales,count(*) as orders
  from public.orders o
  where o.store_id=p_store and o.created_at>=starts and o.created_at<ends
   and o.status='accepted'
   and coalesce(o.receipt->>'is_test','false')='false' and coalesce(o.receipt->>'test','false')='false'
   and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='cancelada')
   and (o.preparation_status='completed' or exists(select 1 from public.deliveries d
     where d.order_id=o.id and d.store_id=o.store_id and d.status='entregue'))
  group by o.source
 )
 select coalesce(sum(sales),0),coalesce(jsonb_agg(
  jsonb_build_object('source',source,'sales_cents',sales,'orders',orders) order by source),'[]'::jsonb)
 into sales_cents,totals from eligible;
 return jsonb_build_object('month',p_month,'sales_cents',sales_cents,'channels',totals,
  'monthly_cents',case when sales_cents>threshold then (policy->>'above_threshold_monthly_cents')::bigint
   else (policy->>'monthly_cents')::bigint end);
end $$;
revoke all on function public.pitacco_owner_monthly_plan_estimate(uuid,date) from public,anon,authenticated;
grant execute on function public.pitacco_owner_monthly_plan_estimate(uuid,date) to authenticated;
