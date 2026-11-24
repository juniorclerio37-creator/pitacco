-- Manager-only customer dossier. Identity is based on a real normalized phone,
-- never on a name or a marketplace relay number. No PIN, device or credential hashes leave the server.
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
 where o.store_id=p_store and x.name<>'';
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
 extras as (select 'phone:'||phone customer_key,phone,name,updated_at last_at from public.pitacco_v2_customer_profiles where store_id=p_store
 union all select 'phone:'||phone,phone,name,created_at from pitacco_private.loyalty_customers where store_id=p_store
 union all select 'phone:'||phone,phone,name,updated_at from public.pitacco_fiado_customers where store_id=p_store
 union all select 'phone:'||pitacco_private.loyalty_normal_phone(match_value),pitacco_private.loyalty_normal_phone(match_value),'Telefone bloqueado',created_at from public.pitacco_customer_blocks where store_id=p_store and match_type='phone' and active),
 unique_extra as (select distinct on(customer_key) * from extras where phone ~ '^[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' order by customer_key,last_at desc nulls last),
 all_rows as (select * from grouped union all select e.customer_key,e.phone,e.name,0::bigint,0::numeric,e.last_at from unique_extra e where not exists(select 1 from grouped g where g.customer_key=e.customer_key)),
 filtered as (select * from all_rows where position(lower(left(coalesce(p_query,''),120)) in lower(name||' '||phone))>0),
 page as (select * from filtered order by last_at desc nulls last,customer_key limit 50 offset p_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.pitacco_merchant_customers(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_customers(uuid,text,integer) to authenticated;

create or replace function public.pitacco_merchant_customer_dossier(p_store uuid,p_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_phone text;lc uuid;fc uuid;result jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_key is null or p_key !~ '^(phone:[0-9]{10,11}|order:[a-f0-9-]{36})$' then raise exception 'Cliente inválido';end if;
 if p_key like 'phone:%' then v_phone:=substr(p_key,7);end if;
 select id into lc from pitacco_private.loyalty_customers where store_id=p_store and phone=v_phone;
 select id into fc from public.pitacco_fiado_customers where store_id=p_store and phone=v_phone;
 with ord as (select * from pitacco_private.merchant_customer_order_rows(p_store) where customer_key=p_key),
 page as (select * from ord order by created_at desc limit 200)
 select jsonb_build_object(
 'order_count',(select count(*) from ord),'cancel_count',(select count(*) from ord where status='cancelled'),
 'total',(select coalesce(sum(gross) filter(where status in ('accepted','historical')),0) from ord),
 'orders',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(jsonb_build_object('name',pr.name,'addresses',pr.addresses,'created_at',pr.created_at)) from public.pitacco_v2_customer_profiles pr where pr.store_id=p_store and pr.phone=v_phone),'[]'::jsonb),
 'loyalty',case when lc is null then null else jsonb_build_object('points',pitacco_private.loyalty_balance(p_store,lc,'points'),'cashback_cents',pitacco_private.loyalty_balance(p_store,lc,'cashback'),'orders',pitacco_private.loyalty_balance(p_store,lc,'orders')) end,
 'ledger',coalesce((select jsonb_agg(to_jsonb(t)) from (select asset,event_type,points_delta,order_id,created_at from public.loyalty_ledger where store_id=p_store and customer_key=lc::text order by created_at desc limit 200)t),'[]'::jsonb),
 'referrals',coalesce((select jsonb_agg(jsonb_build_object('name',c.name,'created_at',c.created_at,'rewarded',c.referral_awarded_order_id is not null)) from pitacco_private.loyalty_customers c where c.store_id=p_store and c.referred_by=lc),'[]'::jsonb),
 'coupons',coalesce((select jsonb_agg(to_jsonb(t)) from (select r.state,r.created_at,c.code,c.title from public.loyalty_coupon_redemptions r join public.loyalty_coupons c on c.id=r.coupon_id and c.store_id=r.store_id where r.store_id=p_store and r.customer_id=lc order by r.created_at desc limit 200)t),'[]'::jsonb),
 'incidents',coalesce((select jsonb_agg(to_jsonb(t)) from (select i.kind,i.state,i.created_at,i.resolved_at,o.display_number from public.pitacco_delivery_incidents i join ord o on o.id=i.order_id where i.store_id=p_store order by i.created_at desc limit 200)t),'[]'::jsonb),
 'fiado',(select jsonb_build_object('enabled',c.enabled,'credit_limit',c.credit_limit,'used',c.used) from public.pitacco_fiado_customers c where c.id=fc and c.store_id=p_store),
 'charges',coalesce((select jsonb_agg(to_jsonb(t)) from (select amount,paid,state,due_at,created_at from public.pitacco_fiado_charges where store_id=p_store and customer_id=fc order by created_at desc limit 200)t),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(t)) from (select amount,method,created_at from public.pitacco_fiado_payments where store_id=p_store and customer_id=fc order by created_at desc limit 200)t),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.pitacco_merchant_customer_dossier(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_customer_dossier(uuid,text) to authenticated;

-- Payment test capability: authorize only a manager of the chosen store, no provider credentials stored.
create or replace function public.pitacco_merchant_payment_test_allowed(p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.is_store_manager(p_store);
$$;
revoke all on function public.pitacco_merchant_payment_test_allowed(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_payment_test_allowed(uuid) to authenticated;
