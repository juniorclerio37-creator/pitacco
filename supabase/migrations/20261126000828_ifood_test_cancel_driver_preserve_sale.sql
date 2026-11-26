
alter table pitacco_private.ifood_shipping_test_bookings add column if not exists cancel_state text not null default 'none' check(cancel_state in ('none','requesting','submitted','uncertain','rejected','confirmed')), add column if not exists cancel_attempt uuid, add column if not exists cancel_requested_at timestamptz, add column if not exists cancel_event_id uuid;
-- Use the same order/delivery/booking locks as the existing test Shipping flow.
create or replace function public.pitacco_ifood_cancel_driver_test(p_store uuid,p_actor uuid,p_order uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; o public.orders%rowtype; d public.deliveries%rowtype; b pitacco_private.ifood_shipping_test_bookings%rowtype; attempt_id uuid; outcome text;
begin
 ctx:=public.pitacco_ifood_shipping_test_context(p_store,p_actor,p_order);
 select * into o from public.orders where id=p_order and store_id=p_store for update;
 select * into d from public.deliveries where order_id=p_order and store_id=p_store for update;
 select * into b from pitacco_private.ifood_shipping_test_bookings where order_id=p_order and store_id=p_store for update;
 if b.order_id is null then raise exception 'Nenhuma solicitação logística vinculada';end if;
 if p_action='claim' then
  if o.status<>'accepted' or d.id is null or d.status<>'pendente' or d.courier_id is not null or d.batch_id is not null or d.collected_at is not null or b.state not in ('submitted','allocated') or coalesce(d.external_delivery_status,'') in ('ASSIGN_DRIVER','DELIVERY_IN_TRANSIT','DELIVERY_CONCLUDED') or b.cancel_state not in ('none','rejected') then raise exception 'Cancelamento logístico indisponível neste estágio';end if;
  attempt_id:=gen_random_uuid();
  update pitacco_private.ifood_shipping_test_bookings set cancel_state='requesting',cancel_attempt=attempt_id,cancel_requested_at=clock_timestamp(),cancel_event_id=null,updated_at=now() where order_id=p_order;
  update public.deliveries set manual_dispatch_hold=true,updated_at=now() where id=d.id;
  insert into public.operation_audit(store_id,order_id,actor,action,details) values(p_store,p_order,p_actor,'shipping_driver_cancel_requested',jsonb_build_object('attempt',attempt_id,'logistics_only',true));
  return jsonb_build_object('attempt',attempt_id,'cancel_state','requesting');
 elsif p_action='finish' then
  if b.cancel_attempt is distinct from (p_data->>'attempt')::uuid or b.cancel_state<>'requesting' then return jsonb_build_object('cancel_state',b.cancel_state,'state',b.state);end if;
  outcome:=case when (p_data->>'http')::integer=202 then 'submitted' when (p_data->>'http')::integer in (400,401,403,404,422) then 'rejected' else 'uncertain' end;
  update pitacco_private.ifood_shipping_test_bookings set cancel_state=outcome,updated_at=now() where order_id=p_order;
  return jsonb_build_object('cancel_state',outcome,'state',b.state);
 else raise exception 'Ação logística inválida';end if;
end $$;
revoke all on function public.pitacco_ifood_cancel_driver_test(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_cancel_driver_test(uuid,uuid,uuid,text,jsonb) to service_role;
do $patch$
declare f text; anchor text;
begin
 select pg_get_functiondef('pitacco_private.guard_shipping_test_booking()'::regprocedure) into f;
 anchor:='b.state in(''requesting'',''submitted'',''uncertain'',''allocated'')';
 if strpos(f,anchor)=0 then raise exception 'Shipping guard anchor missing';end if;
 execute replace(f,anchor,'(b.state in(''requesting'',''submitted'',''uncertain'',''allocated'') or b.cancel_state in(''requesting'',''submitted'',''uncertain''))');
 select pg_get_functiondef('public.guard_marketplace_logistics()'::regprocedure) into f;
 anchor:='raise exception ''Alteração de operador exige fluxo autorizado de migração'';';
 if strpos(f,anchor)=0 then raise exception 'Marketplace guard anchor missing';end if;
 execute replace(f,anchor,$a$if not (old.source='ifood' and new.status='pendente' and old.status='pendente' and new.courier_id is null and new.batch_id is null and new.manual_dispatch_hold and new.external_delivery_status is null and exists(select 1 from pitacco_private.ifood_shipping_test_bookings b where b.order_id=new.order_id and b.store_id=new.store_id and b.cancel_state='confirmed' and b.state='failed' and b.cancel_event_id is not null)) then
    raise exception 'Alteração de operador exige fluxo autorizado de migração';
   end if;$a$);
 select pg_get_functiondef('public.pitacco_ifood_shipping_test_booking(text,uuid,uuid,uuid,jsonb)'::regprocedure) into f;
 f:=replace(f,'elsif p_action=''quote'' then','elsif p_action=''quote'' then if b.cancel_state in (''requesting'',''submitted'',''uncertain'') then raise exception ''Cancelamento logístico pendente'';end if;');
 f:=replace(f,'state=''quoted'',attempt=null,provider_http=null,event_at=null,updated_at=now()','state=''quoted'',attempt=null,provider_http=null,cancel_state=''none'',cancel_attempt=null,cancel_requested_at=null,cancel_event_id=null,updated_at=now()');
 execute f;
 select pg_get_functiondef('public.pitacco_ifood_shipping_test_event(uuid,uuid,uuid,text,timestamptz)'::regprocedure) into f;
 f:=replace(f,'''DELIVERY_CANCELLATION_REQUESTED'',''DELIVERY_CANCELLED''','''DELIVERY_CANCELLATION_REQUESTED'',''DELIVERY_CANCELLATION_REQUEST_ACCEPTED'',''DELIVERY_CANCELLATION_REQUEST_REJECTED'',''DELIVERY_CANCELLED''');
 anchor:='if p_code in(''REQUEST_DRIVER_SUCCESS'',''ASSIGN_DRIVER'') and b.state in(''requesting'',''submitted'',''uncertain'') then';
 if strpos(f,anchor)=0 then raise exception 'Shipping event anchor missing';end if;
 execute replace(f,anchor,$a$if p_code in ('DELIVERY_CANCELLATION_REQUEST_ACCEPTED','DELIVERY_CANCELLATION_REQUEST_REJECTED') then
  if b.cancel_state not in ('requesting','submitted','uncertain') or b.cancel_requested_at is null or p_at<b.cancel_requested_at then return jsonb_build_object('handled',true,'ignored',true);end if;
  if p_code='DELIVERY_CANCELLATION_REQUEST_REJECTED' then
   update pitacco_private.ifood_shipping_test_bookings set cancel_state='rejected',cancel_event_id=p_id,updated_at=now() where order_id=b.order_id;
  elsif o.status='accepted' and d.id is not null and d.status='pendente' and d.courier_id is null and d.batch_id is null and d.collected_at is null and b.state in ('submitted','allocated','uncertain','failed') and coalesce(d.external_delivery_status,'') not in ('DELIVERY_IN_TRANSIT','DELIVERY_CONCLUDED') then
   update pitacco_private.ifood_shipping_test_bookings set cancel_state='confirmed',cancel_event_id=p_id,state='failed',event_at=p_at,updated_at=now() where order_id=b.order_id;
   update public.deliveries set logistics_provider='loja',external_delivery_status=null,manual_dispatch_hold=true,updated_at=now() where id=d.id;
   update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||jsonb_build_object('logistics','loja','ifood_shipping_state','driver_cancelled') where id=b.order_id and store_id=b.store_id;
   insert into public.operation_audit(store_id,order_id,action,details) values(b.store_id,b.order_id,'shipping_driver_cancel_confirmed',jsonb_build_object('event',p_id,'logistics_only',true));
  else
   update pitacco_private.ifood_shipping_test_bookings set cancel_state='uncertain',updated_at=now() where order_id=b.order_id;
  end if;
  return jsonb_build_object('handled',true,'logistics_only',true);
 end if;
 $a$||anchor);
end $patch$;

