alter table pitacco_private.ifood_shipping_test_events add column if not exists proposed_address jsonb;
create or replace function public.pitacco_ifood_shipping_test_address_event(p_id uuid,p_merchant uuid,p_order uuid,p_at timestamptz,p_address jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 r:=public.pitacco_ifood_shipping_test_event(p_id,p_merchant,p_order,'DELIVERY_ADDRESS_CHANGE_REQUESTED',p_at);
 if r->>'handled'='true' and jsonb_typeof(p_address)='object' and octet_length(p_address::text)<=2500 then
  update pitacco_private.ifood_shipping_test_events set proposed_address=p_address
  where id=p_id and merchant_id=p_merchant and external_id=p_order and code='DELIVERY_ADDRESS_CHANGE_REQUESTED' and proposed_address is null;
 end if;
 return r;
end $$;
revoke all on function public.pitacco_ifood_shipping_test_address_event(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_test_address_event(uuid,uuid,uuid,timestamptz,jsonb) to service_role;
create table if not exists pitacco_private.ifood_shipping_external_actions(
 external_id uuid not null references pitacco_private.ifood_shipping_external_tests(external_id),
 kind text not null check(kind in('address','cancel')), request_id uuid not null,
 action text not null check(action in('accept_address','deny_address','cancel')),
 attempt uuid not null, state text not null check(state in('requesting','submitted','uncertain','rejected')),
 reason_code text,provider_http integer,claimed_at timestamptz not null default now(),
 primary key(external_id,kind,request_id)
);
alter table pitacco_private.ifood_shipping_external_actions enable row level security;
revoke all on pitacco_private.ifood_shipping_external_actions from public,anon,authenticated;
create or replace function public.pitacco_ifood_shipping_external_operation(p_store uuid,p_actor uuid,p_external uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; mid uuid; ev pitacco_private.ifood_shipping_test_events%rowtype; a pitacco_private.ifood_shipping_external_actions%rowtype; c pitacco_private.ifood_shipping_external_actions%rowtype; terminal text; cancel_event text; addr_state text; cancel_state text; v_kind text; rid uuid; h integer; op text;
begin
 ctx:=public.pitacco_ifood_shipping_test_context(p_store,p_actor,null);mid:=(ctx->>'merchant_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('shipping-external-operation:'||p_external::text,0));
 if not exists(select 1 from pitacco_private.ifood_shipping_external_tests x where x.external_id=p_external and x.store_id=p_store and x.merchant_id=mid and x.state='submitted') then raise exception 'unknown external test order';end if;
 select e.code into terminal from pitacco_private.ifood_shipping_test_events e where e.merchant_id=mid and e.external_id=p_external and e.code in('CANCELLED','DELIVERY_CONCLUDED','DELIVERY_CANCELLED') order by e.event_at desc,e.id desc limit 1;
 select * into ev from pitacco_private.ifood_shipping_test_events e where e.merchant_id=mid and e.external_id=p_external and e.code in('DELIVERY_ADDRESS_CHANGE_REQUESTED','DELIVERY_ADDRESS_CHANGE_ACCEPTED','DELIVERY_ADDRESS_CHANGE_DENIED') order by e.event_at desc,case when e.code='DELIVERY_ADDRESS_CHANGE_REQUESTED' then 0 else 1 end desc,e.id desc limit 1;
 if ev.code='DELIVERY_ADDRESS_CHANGE_REQUESTED' then
  select * into a from pitacco_private.ifood_shipping_external_actions x where x.external_id=p_external and x.kind='address' and x.request_id=ev.id;
  addr_state:=case when ev.event_at+interval '15 minutes'<=now() then 'expired' when ev.proposed_address is null or ev.proposed_address->>'streetName' is null or ev.proposed_address->>'city' is null then 'address_unavailable' when a.state in('requesting','submitted','uncertain') then a.state else 'pending' end;
 elsif ev.code='DELIVERY_ADDRESS_CHANGE_ACCEPTED' then addr_state:='accepted';
 elsif ev.code='DELIVERY_ADDRESS_CHANGE_DENIED' then addr_state:='denied';
 else addr_state:='none';end if;
 select * into c from pitacco_private.ifood_shipping_external_actions x where x.external_id=p_external and x.kind='cancel' and x.request_id=p_external;
 select e.code into cancel_event from pitacco_private.ifood_shipping_test_events e where e.merchant_id=mid and e.external_id=p_external and e.code in('CANCELLATION_REQUESTED','CANCELLATION_REQUEST_FAILED','CANCELLED') and (c.claimed_at is null or e.event_at>=c.claimed_at-interval '5 seconds' or e.code='CANCELLED') order by e.event_at desc,case when e.code='CANCELLATION_REQUESTED' then 0 else 1 end desc,e.id desc limit 1;
 cancel_state:=case when terminal='CANCELLED' then 'cancelled' when cancel_event='CANCELLATION_REQUEST_FAILED' then 'failed' when cancel_event='CANCELLATION_REQUESTED' then 'submitted' else coalesce(c.state,'none') end;
 if p_action='status' then
  return jsonb_build_object('terminal',terminal,'address_state',addr_state,'address_event_id',ev.id,'address',case when ev.code='DELIVERY_ADDRESS_CHANGE_REQUESTED' then ev.proposed_address end,'address_requested_at',ev.event_at,'address_expires_at',case when ev.code='DELIVERY_ADDRESS_CHANGE_REQUESTED' then ev.event_at+interval '15 minutes' end,'cancel_state',cancel_state);
 end if;
 op:=p_data->>'action';
 if op not in('accept_address','deny_address','cancel') or op is null then raise exception 'invalid operation';end if;
 v_kind:=case when op='cancel' then 'cancel' else 'address' end;
 rid:=case when v_kind='cancel' then p_external else (p_data->>'request_id')::uuid end;
 if p_action='claim' then
  if terminal is not null then raise exception 'order closed';end if;
  if cancel_state in('requesting','submitted','uncertain','cancelled') then raise exception 'cancellation unresolved';end if;
  if v_kind='address' then
   if addr_state<>'pending' or ev.id is distinct from rid or ev.event_at>now() then raise exception 'address request unavailable';end if;
  else
   if addr_state in('requesting','submitted','uncertain') then raise exception 'address decision unresolved';end if;
   if coalesce(p_data->>'reason_code','') !~ '^[0-9]{1,8}$' then raise exception 'invalid cancellation code';end if;
  end if;
  insert into pitacco_private.ifood_shipping_external_actions(external_id,kind,request_id,action,attempt,state,reason_code)
  values(p_external,v_kind,rid,op,gen_random_uuid(),'requesting',case when v_kind='cancel' then p_data->>'reason_code' end)
  on conflict(external_id,kind,request_id) do update set action=excluded.action,attempt=excluded.attempt,state='requesting',reason_code=excluded.reason_code,provider_http=null,claimed_at=now()
  where pitacco_private.ifood_shipping_external_actions.state='rejected' or (excluded.kind='cancel' and cancel_state='failed')
  returning * into a;
  if not found then raise exception 'operation already requested';end if;
  return jsonb_build_object('attempt',a.attempt,'request_id',rid,'createdAt',ev.event_at,'orderId',p_external);
 elsif p_action='finish' then
  h:=(p_data->>'http')::integer;
  update pitacco_private.ifood_shipping_external_actions x set provider_http=h,state=case when (op='accept_address' and h=200) or (op in('deny_address','cancel') and h=202) then 'submitted' when h in(400,401,403,404,422) then 'rejected' else 'uncertain' end
  where x.external_id=p_external and x.kind=v_kind and x.request_id=rid and x.action=op and x.attempt=(p_data->>'attempt')::uuid and x.state='requesting' returning * into a;
  if not found then raise exception 'attempt mismatch';end if;
  return jsonb_build_object('state',a.state,'provider_http',a.provider_http);
 end if;
 raise exception 'invalid action';
end $$;
revoke all on function public.pitacco_ifood_shipping_external_operation(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_external_operation(uuid,uuid,uuid,text,jsonb) to service_role;;
