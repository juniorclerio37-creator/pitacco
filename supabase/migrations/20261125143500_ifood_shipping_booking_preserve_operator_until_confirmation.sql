CREATE OR REPLACE FUNCTION public.pitacco_ifood_shipping_test_booking(p_action text, p_store uuid, p_actor uuid, p_order uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ctx jsonb; o public.orders%rowtype; d public.deliveries%rowtype; b pitacco_private.ifood_shipping_test_bookings%rowtype; q uuid; exp timestamptz; amount numeric; v_attempt uuid; new_state text;
begin
 ctx:=public.pitacco_ifood_shipping_test_context(p_store,p_actor,p_order);
 select * into o from public.orders where id=p_order and store_id=p_store for update;
 if not found then raise exception 'order unavailable';end if;
 select * into d from public.deliveries where order_id=p_order and store_id=p_store for update;
 select * into b from pitacco_private.ifood_shipping_test_bookings where order_id=p_order for update;
 if p_action='status' then
  return coalesce(to_jsonb(b),jsonb_build_object('state','none'));
 elsif p_action='quote' then
  if b.state in ('requesting','submitted','allocated','uncertain','completed','cancelled') then raise exception 'booking already exists';end if;
  if not coalesce((ctx->>'eligible')::boolean,false) then raise exception 'not eligible';end if;
  q:=(p_data->>'id')::uuid;exp:=(p_data->>'expirationAt')::timestamptz;amount:=(p_data->>'netValue')::numeric;
  if q is null or exp<=now() or exp>now()+interval '48 hours' or amount<0 or amount>10000 then raise exception 'invalid quote';end if;
  insert into pitacco_private.ifood_shipping_test_bookings(order_id,store_id,merchant_id,external_id,quote_id,quote_expires_at,quote_amount,state)
  values(p_order,p_store,(ctx->>'merchant_id')::uuid,(ctx->>'external_id')::uuid,q,exp,amount,'quoted')
  on conflict(order_id) do update set quote_id=excluded.quote_id,quote_expires_at=excluded.quote_expires_at,quote_amount=excluded.quote_amount,state='quoted',attempt=null,provider_http=null,event_at=null,updated_at=now();
  return jsonb_build_object('state','quoted','quote_id',q,'quote_amount',amount,'quote_expires_at',exp);
 elsif p_action='claim' then
  q:=(p_data->>'id')::uuid;
  if b.state is distinct from 'quoted' or b.quote_id is distinct from q or b.quote_expires_at<=now() or b.quote_amount is distinct from (p_data->>'netValue')::numeric then raise exception 'quote expired or changed';end if;
  if o.status<>'accepted' or d.id is null or d.status<>'pendente' or d.courier_id is not null or d.collected_at is not null or d.logistics_provider<>'loja' or o.receipt->>'logistics' is distinct from 'loja' then raise exception 'own delivery already allocated or unavailable';end if;
  v_attempt:=gen_random_uuid();
  update pitacco_private.ifood_shipping_test_bookings set state='requesting',attempt=v_attempt,updated_at=now() where order_id=p_order;
  update public.deliveries set external_delivery_status='SHIPPING_REQUESTING',updated_at=now() where id=d.id;
  return jsonb_build_object('state','requesting','attempt',v_attempt,'id',b.quote_id,'expirationAt',b.quote_expires_at,'netValue',b.quote_amount,'orderId',b.external_id);
 elsif p_action='finish' then
  if b.attempt is distinct from (p_data->>'attempt')::uuid or b.state<>'requesting' then return coalesce(to_jsonb(b),'{}'::jsonb);end if;
  new_state:=case when (p_data->>'http')::integer=202 then 'submitted' when (p_data->>'http')::integer in(400,401,403,404,422) then 'failed' else 'uncertain' end;
  update pitacco_private.ifood_shipping_test_bookings set state=new_state,provider_http=(p_data->>'http')::integer,updated_at=now() where order_id=p_order returning * into b;
  if new_state='failed' then
   update public.deliveries set external_delivery_status=null,updated_at=now() where id=d.id and status='pendente' and courier_id is null and external_delivery_status='SHIPPING_REQUESTING';
  else
   update public.deliveries set external_delivery_status=case when new_state='submitted' then 'SHIPPING_SUBMITTED' else 'SHIPPING_UNCERTAIN' end,updated_at=now() where id=d.id and external_delivery_status='SHIPPING_REQUESTING';
  end if;
  return to_jsonb(b);
 end if;
 raise exception 'invalid action';
end $function$
;
create or replace function pitacco_private.guard_shipping_test_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.order_id is not null and (new.courier_id is not null or new.batch_id is not null or new.status in ('atribuida','aceita','retirada')) and exists(select 1 from pitacco_private.ifood_shipping_test_bookings b where b.order_id=new.order_id and b.store_id=new.store_id and b.state in('requesting','submitted','uncertain','allocated')) then raise exception 'Entrega reservada para o parceiro iFood. Aguarde a confirmação oficial.';end if;
 return new;
end $$;
drop trigger if exists pitacco_shipping_test_booking_guard on public.deliveries;
create trigger pitacco_shipping_test_booking_guard before insert or update of courier_id,batch_id,status,logistics_provider on public.deliveries for each row execute function pitacco_private.guard_shipping_test_booking();;
