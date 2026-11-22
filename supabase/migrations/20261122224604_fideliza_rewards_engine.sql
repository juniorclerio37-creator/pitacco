create function pitacco_private.loyalty_entry(s uuid,c uuid,o uuid,a text,delta integer,event text,key text,extra jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
 if delta=0 then return;end if;
 insert into public.loyalty_ledger(store_id,customer_key,order_id,asset,points_delta,event_type,request_key,metadata)
 values(s,c::text,o,a,delta,event,md5(key)::uuid,extra) on conflict(store_id,request_key) do nothing;
end $$;

create function pitacco_private.loyalty_refresh_order(oid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare l pitacco_private.loyalty_order_links%rowtype;o public.orders%rowtype;
 c pitacco_private.loyalty_customers%rowtype; rules jsonb; eligible integer; done boolean;paid boolean;
 v_points integer;v_cash integer;entry record;
begin
 -- Ordem de bloqueio comum ao checkout: loja, cliente e vínculo.
 select * into l from pitacco_private.loyalty_order_links where order_id=oid;
 if not found then return;end if;
 perform 1 from public.public_menu_settings where store_id=l.store_id for update;
 select * into c from pitacco_private.loyalty_customers where id=l.customer_id and store_id=l.store_id for update;
 select * into l from pitacco_private.loyalty_order_links where order_id=oid for update;
 select * into o from public.orders where id=oid and store_id=l.store_id;
 if o.status in ('cancelled','rejected') or o.receipt->>'payment_status' in ('refunded','chargeback','estornado') or exists(select 1 from public.deliveries where order_id=oid and status='cancelada') then
  if l.reversed_at is not null then return;end if;
  for entry in select customer_key,asset,sum(points_delta)::integer as delta from public.loyalty_ledger
   where store_id=l.store_id and order_id=oid and event_type in ('earn','redeem') group by customer_key,asset loop
   perform pitacco_private.loyalty_entry(l.store_id,entry.customer_key::uuid,oid,entry.asset,-entry.delta,'reverse',
    'loyalty:reverse:'||oid::text||':'||entry.customer_key||':'||entry.asset);
  end loop;
  update public.loyalty_coupons cp set uses=greatest(0,cp.uses-1)
   from public.loyalty_coupon_redemptions r where r.order_id=oid and r.store_id=l.store_id
    and r.coupon_id=cp.id and r.state<>'cancelled';
  update public.loyalty_coupon_redemptions set state='cancelled' where order_id=oid and store_id=l.store_id;
  update pitacco_private.loyalty_customers set referral_awarded_order_id=null where referral_awarded_order_id=oid;
  update pitacco_private.loyalty_order_links set reversed_at=now() where order_id=oid;
  insert into public.operation_audit(store_id,order_id,action,details)
   values(l.store_id,oid,'loyalty_order_reversed',jsonb_build_object('customer',l.customer_id));
  return;
 end if;
 if l.earned_at is not null or l.reversed_at is not null then return;end if;
 done:=o.status in ('accepted','historical') and (case when o.receipt->>'logistics'='retirada'
   then o.preparation_status='completed'
   else exists(select 1 from public.deliveries where order_id=oid and store_id=l.store_id and status='entregue') end);
 paid:=exists(select 1 from public.manual_payments mp where mp.order_id=oid and mp.store_id=l.store_id and mp.amount>=o.gross)
  or coalesce(pitacco_private.courier_payment_details(o.receipt,o.gross)->>'state','')='paid'
  or exists(select 1 from public.pitacco_fiado_charges fc where fc.order_id=oid and fc.store_id=l.store_id and fc.state='settled' and fc.paid=fc.amount);
 if not coalesce(done,false) or not coalesce(paid,false) then return;end if;
 update public.loyalty_coupon_redemptions set state='completed' where order_id=oid and state='reserved';
 if l.customer_id is null then
  update pitacco_private.loyalty_order_links set earned_at=now() where order_id=oid;return;
 end if;
 rules:=l.rules;
 eligible:=greatest(0,round((o.gross-coalesce((o.receipt->>'delivery_fee')::numeric,0))*100))::integer;
 if eligible>0 and eligible>=coalesce((rules->>'minimum_order_cents')::integer,0) then
  if (rules->>'points_enabled')::boolean then
   v_points:=floor(eligible::numeric/100*(rules->>'points_per_real')::numeric)::integer;
   perform pitacco_private.loyalty_entry(l.store_id,l.customer_id,oid,'points',v_points,'earn','loyalty:earn:points:'||oid::text);
  end if;
  if (rules->>'orders_enabled')::boolean then
   perform pitacco_private.loyalty_entry(l.store_id,l.customer_id,oid,'orders',1,'earn','loyalty:earn:orders:'||oid::text);
  end if;
  if (rules->>'cashback_enabled')::boolean then
   v_cash:=floor(eligible*(rules->>'cashback_percent')::numeric/100)::integer;
   perform pitacco_private.loyalty_entry(l.store_id,l.customer_id,oid,'cashback',v_cash,'earn','loyalty:earn:cashback:'||oid::text);
  end if;
  if (rules->>'referrals_enabled')::boolean and c.referred_by is not null and c.referral_awarded_order_id is null then
   -- A primeira compra concluída e paga é o único fato gerador de indicação.
   perform pitacco_private.loyalty_entry(l.store_id,c.referred_by,oid,'cashback',(rules->>'referral_reward_cents')::integer,
    'earn','loyalty:referrer:'||oid::text,jsonb_build_object('reason','referral'));
   perform pitacco_private.loyalty_entry(l.store_id,c.id,oid,'cashback',(rules->>'referral_welcome_cents')::integer,
    'earn','loyalty:referred:'||oid::text,jsonb_build_object('reason','referral'));
   update pitacco_private.loyalty_customers set referral_awarded_order_id=oid where id=c.id;
  end if;
 end if;
 update pitacco_private.loyalty_order_links set earned_at=now() where order_id=oid;
 insert into public.operation_audit(store_id,order_id,action,details)
  values(l.store_id,oid,'loyalty_order_earned',jsonb_build_object('customer',l.customer_id,'eligible_cents',eligible));
end $$;

create function pitacco_private.loyalty_cancel_coupon(oid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 select o.store_id into s from public.orders o where o.id=oid and
  (o.status in ('cancelled','rejected') or o.receipt->>'payment_status' in ('refunded','chargeback','estornado') or exists(select 1 from public.deliveries where order_id=oid and status='cancelada'));
 if s is null then return;end if;
 perform 1 from public.public_menu_settings where store_id=s for update;
 update public.loyalty_coupons cp set uses=greatest(0,cp.uses-1)
  from public.loyalty_coupon_redemptions r where r.order_id=oid and r.store_id=s and r.coupon_id=cp.id and r.state<>'cancelled';
 update public.loyalty_coupon_redemptions set state='cancelled' where order_id=oid and store_id=s and state<>'cancelled';
end $$;
create function pitacco_private.loyalty_order_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='orders' then
  perform pitacco_private.loyalty_cancel_coupon(new.id);perform pitacco_private.loyalty_refresh_order(new.id);
 else
  perform pitacco_private.loyalty_cancel_coupon(new.order_id);perform pitacco_private.loyalty_refresh_order(new.order_id);
 end if;
 return new;
end $$;
create trigger loyalty_on_order_change after update of status,preparation_status,receipt on public.orders
 for each row execute function pitacco_private.loyalty_order_event();
create trigger loyalty_on_delivery_change after update of status on public.deliveries
 for each row execute function pitacco_private.loyalty_order_event();
create trigger loyalty_on_manual_payment after insert on public.manual_payments
 for each row execute function pitacco_private.loyalty_order_event();
create trigger loyalty_on_fiado_settlement after update of state,paid on public.pitacco_fiado_charges
 for each row execute function pitacco_private.loyalty_order_event();

create function pitacco_private.loyalty_configuration_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare data jsonb;
begin
 data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='loyalty_coupons' and data->>'kind'='reward' then if tg_op='DELETE' then return old;else return new;end if;end if;
 insert into public.operation_audit(store_id,actor,action,details)
 values((data->>'store_id')::uuid,auth.uid(),'loyalty_configuration_'||lower(tg_op),
  jsonb_build_object('table',tg_table_name,'settings',data,'before',case when tg_op<>'INSERT' then to_jsonb(old) end));
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger loyalty_program_audit after insert or update on public.loyalty_programs
 for each row execute function pitacco_private.loyalty_configuration_audit();
create trigger loyalty_coupon_audit after insert or update or delete on public.loyalty_coupons
 for each row execute function pitacco_private.loyalty_configuration_audit();
revoke all on function pitacco_private.loyalty_entry(uuid,uuid,uuid,text,integer,text,text,jsonb),
 pitacco_private.loyalty_refresh_order(uuid),pitacco_private.loyalty_cancel_coupon(uuid),pitacco_private.loyalty_order_event(),pitacco_private.loyalty_configuration_audit() from public,anon,authenticated;
