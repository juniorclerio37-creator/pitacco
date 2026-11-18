-- Calcula remuneração no mesmo registro que abastece gestor e motoboy.
-- Nunca inventa tarifa se o entregador não tem regra vinculada.
-- Nunca recalcula pagamento histórico já registrado.
create or replace function pitacco_private.assign_courier_completion_earnings()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare
 v_rule public.pitacco_courier_pay_rules%rowtype;
 v_amount numeric(12,2);
 v_distance numeric;
begin
 if new.logistics_provider<>'loja' then return new; end if;
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

 -- Daily allowances are accounted for separately by the store. Never
 -- charge one daily rate per completed delivery.
 if v_rule.mode='daily' then return new;end if;
 if v_rule.mode in ('per_km','mixed') and coalesce(v_rule.km_rate,0)>0 then
  select s.road_distance_km into v_distance
  from public.pitacco_delivery_pay_snapshots s
  where s.delivery_id=new.id and s.courier_id=new.courier_id
    and s.store_id=new.store_id;
  -- No road estimate: don't invent distance or silently underpay a km rule.
  if v_distance is null then return new;end if;
 end if;
 v_amount:=coalesce(v_rule.rate,0);
 if v_rule.mode in ('per_delivery','mixed') then
  v_amount:=v_amount+coalesce(v_rule.per_delivery_rate,0);
 end if;
 if v_rule.mode in ('per_km','mixed') then
  v_amount:=v_amount+coalesce(v_distance,0)*coalesce(v_rule.km_rate,0);
 end if;
 if v_rule.mode='customer_fee' or v_rule.include_customer_fee then
  v_amount:=v_amount+coalesce(new.delivery_fee,0);
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
     'customer_fee',new.delivery_fee,'calculated_on','completion'
   ),v_amount
 ) on conflict (delivery_id) do nothing;
 return new;
end $$;

drop trigger if exists pitacco_courier_completion_earnings on public.deliveries;
create trigger pitacco_courier_completion_earnings
before update of status on public.deliveries
for each row when (old.status is distinct from new.status)
execute function pitacco_private.assign_courier_completion_earnings();

-- Read-only contract: the courier and merchant reports use
-- deliveries.courier_payment, and filter status='entregue'; cancelled=0.
