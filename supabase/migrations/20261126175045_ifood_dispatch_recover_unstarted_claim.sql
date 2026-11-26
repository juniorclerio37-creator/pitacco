-- Legacy claims remain conservative; only v2 can recover an unstarted claim.
alter table pitacco_private.ifood_courier_dispatch add column provider_started_at timestamptz;
update pitacco_private.ifood_courier_dispatch set provider_started_at=requested_at;
alter table pitacco_private.ifood_courier_dispatch alter column provider_started_at set default now();
CREATE OR REPLACE FUNCTION public.pitacco_driver_ifood_dispatch_claim_v2(p_delivery uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 d public.deliveries%rowtype;
 o public.orders%rowtype;
 v_external uuid;
 v_merchant uuid;
 v_claim pitacco_private.ifood_courier_dispatch%rowtype;
 v_lease uuid := p_request;
begin
 if p_request is null or (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão de entregador não autorizada' using errcode='42501';
 end if;
 select src.* into d
 from public.deliveries src join public.couriers c
   on c.id=src.courier_id and c.user_id=(select auth.uid()) and c.active
   and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))
 where src.id=p_delivery and src.logistics_provider='loja' and src.source='ifood'
 for update of src;
 if not found then raise exception 'Entrega iFood não atribuída a este entregador' using errcode='42501'; end if;
 if d.collected_at is null or d.status<>'retirada' then
   raise exception 'Saia para entrega no Pitacco antes de despachar ao iFood' using errcode='22023';
 end if;
 select * into o from public.orders
 where id=d.order_id and store_id=d.store_id and source='ifood';
 if not found or o.status<>'accepted' or o.preparation_status<>'ready' then
   raise exception 'O pedido precisa estar aceito e pronto antes do despacho iFood' using errcode='22023';
 end if;
 if o.receipt->>'ifood_status' in ('DISPATCHED','CONCLUDED') then
   return jsonb_build_object('status','already_confirmed');
 end if;
 if o.receipt->>'ifood_status'='CANCELLED' then
   raise exception 'O pedido foi cancelado no iFood' using errcode='22023';
 end if;
 select l.external_id,m.merchant_id into v_external,v_merchant
 from pitacco_private.ifood_order_links l
 join pitacco_private.ifood_merchants m
   on m.merchant_id=l.merchant_id and m.store_id=d.store_id and m.enabled
 where l.order_id=d.order_id
   and (m.test_only or m.credential is null or (select merchant_linking from pitacco_private.ifood_control limit 1));
 if v_external is null or v_merchant is null then
   raise exception 'Conexão iFood ainda não homologada para a loja' using errcode='22023';
 end if;
 select * into v_claim from pitacco_private.ifood_courier_dispatch
 where delivery_id=d.id for update;
 if found and v_claim.state in ('submitted','uncertain') then
   return jsonb_build_object('status',v_claim.state);
 end if;
 if found and v_claim.state='claimed' and v_claim.provider_started_at is null then
   -- Same server request can safely recover its lease after a lost RPC response.
   if v_claim.lease=p_request then
     return jsonb_build_object('status','claimed','lease',v_claim.lease,'external_order_id',v_external,'merchant_id',v_merchant,'ready_on_ifood',(o.receipt->>'ifood_status' in ('READY_TO_PICKUP','DISPATCHED','CONCLUDED')));
   end if;
   if v_claim.requested_at>=now()-interval '30 seconds' then return jsonb_build_object('status','pending'); end if;
 elsif found and v_claim.state='claimed' then
   -- A stale claim is uncertain: it might already have reached iFood.
   -- Never silently retry an ambiguous network outcome.
   if v_claim.requested_at < now()-interval '90 seconds' then
     update pitacco_private.ifood_courier_dispatch set state='uncertain',
       resolved_at=now(),updated_at=now() where delivery_id=d.id;
     return jsonb_build_object('status','uncertain');
   end if;
   return jsonb_build_object('status','pending');
 end if;
 insert into pitacco_private.ifood_courier_dispatch(
   delivery_id,state,lease,requested_at,resolved_at,provider_http_status,updated_at,provider_started_at
 ) values(d.id,'claimed',v_lease,now(),null,null,now(),null)
 on conflict(delivery_id) do update set
   state='claimed',lease=excluded.lease,requested_at=excluded.requested_at,
   resolved_at=null,provider_http_status=null,updated_at=now(),provider_started_at=null;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(d.store_id,d.order_id,(select auth.uid()),'ifood_dispatch_claimed_after_departure',
    jsonb_build_object('delivery',d.id,'collected_at',d.collected_at,'departure_status',d.status));
 return jsonb_build_object(
  'status','claimed','lease',v_lease,
  'external_order_id',v_external,'merchant_id',v_merchant,
  'ready_on_ifood',(o.receipt->>'ifood_status' in ('READY_TO_PICKUP','DISPATCHED','CONCLUDED'))
 );
end;
$function$;
revoke all on function public.pitacco_driver_ifood_dispatch_claim_v2(uuid,uuid) from public,anon,service_role;
grant execute on function public.pitacco_driver_ifood_dispatch_claim_v2(uuid,uuid) to authenticated;
create or replace function public.pitacco_ifood_dispatch_begin(p_delivery uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.deliveries%rowtype; v_started uuid;
begin
 if (select auth.role()) is distinct from 'service_role' then raise exception 'Acesso restrito' using errcode='42501';end if;
 select * into d from public.deliveries where id=p_delivery and source='ifood' and logistics_provider='loja' and status='retirada' and collected_at is not null for update;
 if not found then return false;end if;
 if not exists(select 1 from public.orders o where o.id=d.order_id and o.store_id=d.store_id and o.source='ifood' and o.status='accepted' and o.preparation_status='ready' and coalesce(o.receipt->>'ifood_status','') not in ('DISPATCHED','CONCLUDED','CANCELLED')) then return false;end if;
 update pitacco_private.ifood_courier_dispatch set provider_started_at=now(),updated_at=now()
 where delivery_id=p_delivery and lease=p_lease and state='claimed' and provider_started_at is null returning delivery_id into v_started;
 return v_started is not null;
end $$;
revoke all on function public.pitacco_ifood_dispatch_begin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_dispatch_begin(uuid,uuid) to service_role;
