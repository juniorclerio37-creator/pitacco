-- Preserve the fee BEFORE promotions so merchant-paid shipping benefits
-- never reduce the courier's agreed customer_fee compensation.
alter table public.deliveries
 add column if not exists original_delivery_fee numeric(12,2)
 check (original_delivery_fee between 0 and 9999.99);

-- Backfill only evidence found in the original order. Never infer a nonzero
-- fee for orders whose source payload has no trace of original freight.
update public.deliveries d
 set original_delivery_fee=case
   when o.receipt ? 'delivery_fee_original'
     and pg_catalog.jsonb_typeof(o.receipt->'delivery_fee_original')='number'
     then (o.receipt->>'delivery_fee_original')::numeric
   when o.source in ('ifood','proprio')
     and pg_catalog.jsonb_typeof(o.receipt->'delivery_fee')='number'
     then (o.receipt->>'delivery_fee')::numeric
   when d.delivery_fee>0 then d.delivery_fee
   else null end
 from public.orders o
 where d.order_id=o.id and d.store_id=o.store_id
   and d.original_delivery_fee is null
   and ((o.receipt ? 'delivery_fee_original'
          and pg_catalog.jsonb_typeof(o.receipt->'delivery_fee_original')='number')
     or (o.source in ('ifood','proprio')
         and pg_catalog.jsonb_typeof(o.receipt->'delivery_fee')='number')
     or d.delivery_fee>0);

-- Set original value only once, from trusted order details or a manually
-- entered positive fee. Never trust a client-supplied edited original.
create or replace function pitacco_private.capture_original_delivery_fee()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare o public.orders%rowtype; v_original numeric;
begin
 if tg_op='UPDATE' and old.original_delivery_fee is not null then
  new.original_delivery_fee:=old.original_delivery_fee;
  return new;
 end if;
 new.original_delivery_fee:=null;
 if new.order_id is not null then
  select * into o from public.orders
  where id=new.order_id and store_id=new.store_id;
  if found then
   if o.receipt ? 'delivery_fee_original'
      and pg_catalog.jsonb_typeof(o.receipt->'delivery_fee_original')='number' then
     v_original:=(o.receipt->>'delivery_fee_original')::numeric;
   elsif o.source in ('ifood','proprio')
       and pg_catalog.jsonb_typeof(o.receipt->'delivery_fee')='number' then
     v_original:=(o.receipt->>'delivery_fee')::numeric;
   end if;
  end if;
 end if;
 if v_original is null and new.delivery_fee>0 then v_original:=new.delivery_fee;end if;
 if v_original between 0 and 9999.99 then
  new.original_delivery_fee:=pg_catalog.round(v_original,2);
 end if;
 return new;
end $$;
drop trigger if exists pitacco_capture_original_delivery_fee on public.deliveries;
create trigger pitacco_capture_original_delivery_fee
before insert or update of order_id,delivery_fee,original_delivery_fee on public.deliveries
for each row execute function pitacco_private.capture_original_delivery_fee();

-- The actual amount paid to the courier is stored in deliveries once and
-- read by both customer-facing and merchant financial summaries.
create or replace function pitacco_private.assign_courier_completion_earnings()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare
 v_rule public.pitacco_courier_pay_rules%rowtype;
 v_amount numeric(12,2);
 v_distance numeric;
 v_original numeric;
begin
 if new.logistics_provider<>'loja' then return new;end if;
 if new.status='cancelada' then
  new.courier_payment:=0;
  return new;
 end if;
 if new.status<>'entregue' or old.status='entregue'
    or new.courier_id is null or coalesce(new.courier_payment,0)>0 then
  return new;
 end if;
 select * into v_rule from public.pitacco_courier_pay_rules r
  where r.store_id=new.store_id and r.courier_id=new.courier_id;
 if not found then return new;end if;
 -- Daily compensation belongs to the once-per-day ledger, not each order.
 if v_rule.mode='daily' then return new;end if;
 if v_rule.mode in ('per_km','mixed') and coalesce(v_rule.km_rate,0)>0 then
  select s.road_distance_km into v_distance
  from public.pitacco_delivery_pay_snapshots s
  where s.delivery_id=new.id and s.courier_id=new.courier_id
    and s.store_id=new.store_id;
  if v_distance is null then return new;end if;
 end if;
 v_original:=new.original_delivery_fee;
 if v_original is null and new.delivery_fee>0 then v_original:=new.delivery_fee;end if;
 v_amount:=coalesce(v_rule.rate,0);
 if v_rule.mode in ('per_delivery','mixed') then
  v_amount:=v_amount+coalesce(v_rule.per_delivery_rate,0);
 end if;
 if v_rule.mode in ('per_km','mixed') then
  v_amount:=v_amount+coalesce(v_distance,0)*coalesce(v_rule.km_rate,0);
 end if;
 if v_rule.mode='customer_fee' or v_rule.include_customer_fee then
  -- Never use an already-discounted zero to *guess* the original freight.
  if v_original is null then return new;end if;
  v_amount:=v_amount+v_original;
 end if;
 v_amount:=pg_catalog.round(v_amount,2);
 if v_amount<=0 then return new;end if;
 new.courier_payment:=v_amount;
 insert into public.pitacco_delivery_pay_snapshots(
   delivery_id,store_id,courier_id,road_distance_km,pay_mode,rule_snapshot,delivery_amount
 ) values(
   new.id,new.store_id,new.courier_id,v_distance,v_rule.mode,
   pg_catalog.jsonb_build_object(
    'rate',v_rule.rate,'per_delivery_rate',v_rule.per_delivery_rate,
    'km_rate',v_rule.km_rate,'include_customer_fee',v_rule.include_customer_fee,
    'original_delivery_fee',v_original,'customer_paid_delivery_fee',new.delivery_fee,
    'calculated_on','completion'
   ),v_amount
 ) on conflict (delivery_id) do nothing;
 return new;
end $$;

-- One daily allowance per store, courier and completed workday. No allowance
-- from a cancelled delivery alone. User-entered allowances are never changed.
create or replace function pitacco_private.post_courier_workday_earnings()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare r public.pitacco_courier_pay_rules%rowtype;
 v_date date;
begin
 if new.logistics_provider<>'loja' or new.courier_id is null then return new;end if;
 if new.status='entregue' and old.status<>'entregue' then
  select * into r from public.pitacco_courier_pay_rules
  where store_id=new.store_id and courier_id=new.courier_id;
  if found and r.mode in ('daily','mixed') and coalesce(r.daily_rate,0)>0 then
   v_date:=(new.updated_at at time zone 'America/Sao_Paulo')::date;
   insert into public.pitacco_courier_daily_allowances(
      store_id,courier_id,work_date,amount,rule_snapshot)
   values(new.store_id,new.courier_id,v_date,r.daily_rate,
     pg_catalog.jsonb_build_object('origin','automatic_courier_remuneration',
       'mode',r.mode,'daily_rate',r.daily_rate))
   on conflict (store_id,courier_id,work_date) do nothing;
  end if;
 elsif new.status='cancelada' and old.status='entregue' then
  v_date:=(old.updated_at at time zone 'America/Sao_Paulo')::date;
  delete from public.pitacco_courier_daily_allowances a
  where a.store_id=new.store_id and a.courier_id=new.courier_id
    and a.work_date=v_date
    and a.rule_snapshot->>'origin'='automatic_courier_remuneration'
    and not exists (
      select 1 from public.deliveries d
      where d.store_id=new.store_id and d.courier_id=new.courier_id
       and d.status='entregue' and d.logistics_provider='loja'
       and (d.updated_at at time zone 'America/Sao_Paulo')::date=v_date
    );
 end if;
 return new;
end $$;
drop trigger if exists pitacco_courier_workday_earnings on public.deliveries;
create trigger pitacco_courier_workday_earnings
after update of status on public.deliveries
for each row when (old.status is distinct from new.status)
execute function pitacco_private.post_courier_workday_earnings();
notify pgrst,'reload schema';
