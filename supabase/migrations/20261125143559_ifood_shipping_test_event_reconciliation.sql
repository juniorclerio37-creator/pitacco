create table if not exists pitacco_private.ifood_shipping_test_events(
 id uuid primary key,
 merchant_id uuid not null references pitacco_private.ifood_merchants(merchant_id),
 external_id uuid not null,
 code text not null check(char_length(code) between 1 and 80),
 event_at timestamptz not null,
 received_at timestamptz not null default now()
);
alter table pitacco_private.ifood_shipping_test_events enable row level security;
revoke all on pitacco_private.ifood_shipping_test_events from public,anon,authenticated;
create index if not exists ifood_shipping_test_events_order on pitacco_private.ifood_shipping_test_events(merchant_id,external_id,event_at desc);
create or replace function public.pitacco_ifood_shipping_test_event(p_id uuid,p_merchant uuid,p_order uuid,p_code text,p_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b pitacco_private.ifood_shipping_test_bookings%rowtype; d public.deliveries%rowtype; o public.orders%rowtype; inserted integer;
begin
 if not exists(select 1 from pitacco_private.ifood_merchants where merchant_id=p_merchant and test_only and enabled and credential is null) then return jsonb_build_object('handled',false);end if;
 if p_code not in('REQUEST_DRIVER','REQUEST_DRIVER_SUCCESS','REQUEST_DRIVER_FAILED','ASSIGN_DRIVER','DELIVERY_CANCELLATION_REQUESTED','DELIVERY_CANCELLED','DELIVERY_CONCLUDED','DELIVERY_IN_TRANSIT','DELIVERY_ADDRESS_CHANGE_REQUESTED','DELIVERY_ADDRESS_CHANGE_ACCEPTED','DELIVERY_ADDRESS_CHANGE_DENIED','DELIVERY_ADDRESS_CHANGE_USER_CONFIRMED','DELIVERY_DROP_CODE_REQUESTED','CANCELLATION_REQUESTED','CANCELLATION_REQUEST_FAILED','CANCELLED') then return jsonb_build_object('handled',false);end if;
 if p_id is null or p_order is null or p_at is null then raise exception 'invalid event';end if;
 insert into pitacco_private.ifood_shipping_test_events(id,merchant_id,external_id,code,event_at) values(p_id,p_merchant,p_order,p_code,p_at) on conflict(id) do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return jsonb_build_object('handled',true,'duplicate',true);end if;
 -- Match lock order to the booking RPC: order, delivery, then booking.
 select * into b from pitacco_private.ifood_shipping_test_bookings where merchant_id=p_merchant and external_id=p_order;
 if not found then return jsonb_build_object('handled',true,'duplicate',false,'linked',false);end if;
 select * into o from public.orders where id=b.order_id and store_id=b.store_id for update;
 select * into d from public.deliveries where order_id=b.order_id and store_id=b.store_id for update;
 select * into b from pitacco_private.ifood_shipping_test_bookings where order_id=b.order_id for update;
 if p_at<coalesce(b.event_at,'-infinity'::timestamptz) then return jsonb_build_object('handled',true,'stale',true);end if;
 if p_code in('REQUEST_DRIVER_SUCCESS','ASSIGN_DRIVER') and b.state in('requesting','submitted','uncertain') then
  if d.id is null or d.courier_id is not null or d.batch_id is not null or d.status<>'pendente' or o.status<>'accepted' then
   update pitacco_private.ifood_shipping_test_bookings set state='uncertain',event_at=p_at,updated_at=now() where order_id=b.order_id;
   return jsonb_build_object('handled',true,'conflict',true);
  end if;
  update pitacco_private.ifood_shipping_test_bookings set state='allocated',event_at=p_at,updated_at=now() where order_id=b.order_id;
  update public.deliveries set logistics_provider='marketplace',external_delivery_status=p_code,updated_at=now() where id=d.id;
  update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||jsonb_build_object('logistics','marketplace','ifood_shipping_state','allocated') where id=b.order_id;
 elsif p_code='REQUEST_DRIVER_FAILED' and b.state in('requesting','submitted','uncertain') then
  update pitacco_private.ifood_shipping_test_bookings set state='failed',event_at=p_at,updated_at=now() where order_id=b.order_id;
  update public.deliveries set external_delivery_status=null,updated_at=now() where id=d.id and logistics_provider='loja' and courier_id is null and status='pendente' and external_delivery_status in('SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN');
 elsif p_code in('CANCELLED','DELIVERY_CANCELLED') and b.state in('requesting','submitted','uncertain','allocated') then
  -- A cancelled partner request requires operator reconciliation; do not silently allocate another driver.
  update pitacco_private.ifood_shipping_test_bookings set state=case when p_code='CANCELLED' then 'cancelled' else 'uncertain' end,event_at=p_at,updated_at=now() where order_id=b.order_id;
  update public.deliveries set external_delivery_status=p_code,updated_at=now() where id=d.id;
 elsif p_code='DELIVERY_CONCLUDED' and b.state='allocated' and d.logistics_provider='marketplace' then
  update pitacco_private.ifood_shipping_test_bookings set state='completed',event_at=p_at,updated_at=now() where order_id=b.order_id;
  update public.deliveries set status='entregue',external_delivery_status=p_code,updated_at=now() where id=d.id and status not in('entregue','cancelada');
 elsif p_code='DELIVERY_IN_TRANSIT' and b.state='allocated' then
  update pitacco_private.ifood_shipping_test_bookings set event_at=p_at,updated_at=now() where order_id=b.order_id;
  update public.deliveries set external_delivery_status=p_code,updated_at=now() where id=d.id and status not in('entregue','cancelada');
 end if;
 return jsonb_build_object('handled',true,'duplicate',false,'linked',true);
end $$;
revoke all on function public.pitacco_ifood_shipping_test_event(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_test_event(uuid,uuid,uuid,text,timestamptz) to service_role;;
