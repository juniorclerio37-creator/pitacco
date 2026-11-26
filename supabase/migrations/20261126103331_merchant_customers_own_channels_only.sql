-- Merchant customer registry: own storefront and counter orders only.
-- Preserve storefront customer profiles, never promote marketplace orders or standalone module records into CRM.
create or replace function pitacco_private.merchant_customer_order_rows(p_store uuid)
returns table(id uuid,customer_key text,customer_name text,phone text,created_at timestamptz,status text,source text,channel text,gross numeric,fees numeric,display_number text,cancellation_reason text)
language sql stable set search_path='' as $$
 select o.id,case when x.phone ~ '^[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' then 'phone:'||x.phone else 'order:'||o.id::text end,
 x.name,case when x.phone ~ '^[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' then x.phone else '' end,
 o.created_at,o.status,o.source,o.channel,o.gross,o.fees,
 coalesce(nullif(o.receipt->>'display_number',''),nullif(o.receipt->>'order_number',''),nullif(o.receipt->>'external_order_number',''),left(o.id::text,8)),
 coalesce(o.receipt->>'cancellation_reason',o.receipt->>'cancel_reason',o.receipt->>'ifood_manual_cancel_reason',
 (select a.details->>'reason' from public.operation_audit a where a.store_id=p_store and a.order_id=o.id and a.action in ('order_cancelled','marketplace_cancelled_synced') order by a.created_at desc limit 1))
 from public.orders o
 left join public.public_checkouts pc on pc.order_id=o.id and pc.store_id=o.store_id
 cross join lateral (select
  pitacco_private.loyalty_normal_phone(coalesce(nullif(pc.phone,''),nullif(o.receipt->>'customer_phone',''),o.receipt->>'phone')) phone,
  trim(coalesce(nullif(o.receipt->>'customer',''),nullif(o.receipt->>'customer_name',''),pc.payload->>'customer','')) name) x
 where o.store_id=p_store and o.source='proprio' and x.name<>'';
$$;
revoke all on function pitacco_private.merchant_customer_order_rows(uuid) from public,anon,authenticated;

create or replace function public.pitacco_merchant_customers(p_store uuid,p_query text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Página inválida';end if;
 with ord as (select * from pitacco_private.merchant_customer_order_rows(p_store)),
 grouped as (select customer_key,phone,(array_agg(customer_name order by created_at desc))[1] name,count(*) orders,
 coalesce(sum(gross) filter(where status in ('accepted','historical')),0) total,max(created_at) last_at from ord group by customer_key,phone),
 extras as (select 'phone:'||phone customer_key,phone,name,updated_at last_at from public.pitacco_v2_customer_profiles where store_id=p_store),
 unique_extra as (select distinct on(customer_key) * from extras where phone ~ '^[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' order by customer_key,last_at desc nulls last),
 all_rows as (select * from grouped union all select e.customer_key,e.phone,e.name,0::bigint,0::numeric,e.last_at from unique_extra e where not exists(select 1 from grouped g where g.customer_key=e.customer_key)),
 filtered as (select * from all_rows where position(lower(left(coalesce(p_query,''),120)) in lower(name||' '||phone))>0),
 page as (select * from filtered order by last_at desc nulls last,customer_key limit 50 offset p_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.pitacco_merchant_customers(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_customers(uuid,text,integer) to authenticated;

