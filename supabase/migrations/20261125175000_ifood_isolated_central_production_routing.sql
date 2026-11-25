create or replace function public.pitacco_ifood_central_environment(p_merchant uuid)
returns text language sql stable security definer set search_path='' as $$
select case when test_only then 'test' else 'production' end from pitacco_private.ifood_merchants where merchant_id=p_merchant and enabled and credential is null
$$;
create or replace function public.pitacco_ifood_central_enqueue(p_id uuid,p_merchant uuid,p_order uuid,p_code text,p_at timestamptz,p_production boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 insert into pitacco_private.ifood_events(id,merchant_id,order_id,code,event_at)
 select p_id,merchant_id,p_order,p_code,p_at from pitacco_private.ifood_merchants where merchant_id=p_merchant and enabled and credential is null and test_only=not p_production
 on conflict(id) do nothing;return found;
end $$;
create or replace function public.pitacco_ifood_central_online(p_merchants uuid[],p_production boolean)
returns uuid[] language sql stable security definer set search_path='' as $$
select coalesce(array_agg(merchant_id),array[]::uuid[]) from pitacco_private.ifood_merchants where enabled and credential is null and test_only=not p_production and merchant_id=any(p_merchants) and cardinality(p_merchants)<=1000
$$;
revoke all on function public.pitacco_ifood_central_environment(uuid),public.pitacco_ifood_central_enqueue(uuid,uuid,uuid,text,timestamptz,boolean),public.pitacco_ifood_central_online(uuid[],boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_central_environment(uuid),public.pitacco_ifood_central_enqueue(uuid,uuid,uuid,text,timestamptz,boolean),public.pitacco_ifood_central_online(uuid[],boolean) to service_role;
CREATE OR REPLACE FUNCTION public.pitacco_driver_ifood_dispatch_claim(p_delivery uuid)
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
 v_lease uuid := gen_random_uuid();
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
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
 if found and v_claim.state='claimed' then
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
   delivery_id,state,lease,requested_at,resolved_at,provider_http_status,updated_at
 ) values(d.id,'claimed',v_lease,now(),null,null,now())
 on conflict(delivery_id) do update set
   state='claimed',lease=excluded.lease,requested_at=excluded.requested_at,
   resolved_at=null,provider_http_status=null,updated_at=now();
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(d.store_id,d.order_id,(select auth.uid()),'ifood_dispatch_claimed_after_departure',
    jsonb_build_object('delivery',d.id,'collected_at',d.collected_at,'departure_status',d.status));
 return jsonb_build_object(
  'status','claimed','lease',v_lease,
  'external_order_id',v_external,'merchant_id',v_merchant,
  'ready_on_ifood',(o.receipt->>'ifood_status' in ('READY_TO_PICKUP','DISPATCHED','CONCLUDED'))
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pitacco_ifood_manual_access(p_order uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype;
        l pitacco_private.ifood_order_links%rowtype;
        m pitacco_private.ifood_merchants%rowtype;
        pref public.acceptance_settings%rowtype;
begin
 if auth.role()<>'service_role' or p_actor is null then raise exception 'Acesso exclusivo à integração autenticada' using errcode='42501'; end if;
 select * into o from public.orders where id=p_order;
 if not found or o.source<>'ifood' or (o.status not in ('pending','accepted') or o.preparation_status='completed' or exists(select 1 from public.deliveries d where d.order_id=o.id and d.status='entregue')) then raise exception 'Pedido não está pendente no iFood'; end if;
 if not exists(select 1 from public.store_members sm where sm.store_id=o.store_id and sm.user_id=p_actor and sm.role in ('gestor','lojista'))
   and not (exists(select 1 from pitacco_private.platform_owner po where po.user_id=p_actor) and o.receipt->>'ifood_test'='true')
 then raise exception 'Sem permissão para gerenciar este pedido' using errcode='42501'; end if;
 select * into l from pitacco_private.ifood_order_links where order_id=p_order;
 if not found then raise exception 'Pedido não disponível para aceite ou recusa'; end if;
 select * into m from pitacco_private.ifood_merchants
   where merchant_id=l.merchant_id and store_id=o.store_id and enabled
     and (test_only or credential is null or (select merchant_linking from pitacco_private.ifood_control limit 1));
 if not found then raise exception 'Vínculo iFood não autorizado'; end if;
 if (o.receipt->>'ifood_test')::boolean is distinct from m.test_only then
   raise exception 'Ambiente iFood não corresponde à loja';
 end if;
 select * into pref from public.acceptance_settings where store_id=o.store_id and source='ifood';
 -- Acceptance remains guarded by pitacco_ifood_manual_request. Cancellation is independent of acceptance mode.
 return jsonb_build_object('external_order_id',l.external_id,'merchant_id',m.merchant_id,
   'accept_pending',o.receipt->>'ifood_manual_accept'='requested',
   'cancel_pending',o.receipt->>'ifood_manual_cancel'='requested');
end $function$
;
CREATE OR REPLACE FUNCTION public.pitacco_ifood_manual_request(p_order uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.orders%rowtype;
  l pitacco_private.ifood_order_links%rowtype;
  m pitacco_private.ifood_merchants%rowtype;
  req public.marketplace_acceptance_requests%rowtype;
  pref public.acceptance_settings%rowtype;
begin
  if auth.role() <> 'service_role' or p_actor is null then raise exception 'Acesso exclusivo à integração autenticada' using errcode='42501'; end if;
  select * into o from public.orders where id=p_order for update;
  if not found or o.source <> 'ifood' then raise exception 'Pedido iFood não encontrado'; end if;
  if not exists (
    select 1 from public.store_members sm
    where sm.store_id=o.store_id and sm.user_id=p_actor and sm.role in ('lojista','gestor')
  ) and not (exists(select 1 from pitacco_private.platform_owner po where po.user_id=p_actor) and o.receipt->>'ifood_test' = 'true') then
    raise exception 'Sem permissão para aceitar pedidos desta loja' using errcode='42501';
  end if;
  select * into l from pitacco_private.ifood_order_links where order_id=p_order for update;
  if not found then raise exception 'Vínculo original do pedido iFood não encontrado'; end if;
  select * into m from pitacco_private.ifood_merchants
    where merchant_id=l.merchant_id and store_id=o.store_id and enabled
      and (test_only or credential is null or (select merchant_linking from pitacco_private.ifood_control limit 1))
    for share;
  if not found then raise exception 'Loja iFood indisponível para confirmação'; end if;
  if (o.receipt->>'ifood_test')::boolean is distinct from m.test_only
    then raise exception 'Ambiente iFood incompatível'; end if;
  if o.receipt->>'ifood_manual_cancel' = 'requested' then raise exception 'Cancelamento já solicitado ao iFood'; end if;
  if o.status <> 'pending' or l.state_rank <> 1
    then raise exception 'Pedido já processado ou fora do estado de aceite'; end if;
  if l.event_at < now()-interval '8 minutes'
    then raise exception 'Prazo de 8 minutos do iFood encerrado'; end if;
  select * into pref from public.acceptance_settings where store_id=o.store_id and source='ifood';
  if found then
    if not pref.enabled or pref.mode <> 'manual' then
      raise exception 'Aceite manual do iFood desativado nesta loja';
    end if;
  elsif not m.test_only then
    raise exception 'Configure o aceite manual do iFood para esta loja';
  end if;
  select * into req from public.marketplace_acceptance_requests where order_id=p_order for update;
  if found then
    if req.source <> 'ifood' or req.store_id <> o.store_id or req.external_order_id <> l.external_id::text
      then raise exception 'Identificador do pedido incompatível'; end if;
    if req.state = 'requested' then return jsonb_build_object('status','already_requested'); end if;
    if req.state = 'confirmed' then raise exception 'Pedido já confirmado'; end if;
    update public.marketplace_acceptance_requests
      set state='requested',provider_confirmation_id=null,provider_message=null,
          confirmed_at=null,created_at=now()
      where id=req.id;
  else
    insert into public.marketplace_acceptance_requests(store_id,order_id,source,external_order_id,state)
      values(o.store_id,p_order,'ifood',l.external_id::text,'requested');
  end if;
  update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||
    jsonb_build_object('ifood_manual_accept','requested') where id=p_order;
  insert into public.operation_audit(store_id,order_id,actor,action,details)
    values(o.store_id,p_order,p_actor,'ifood_manual_accept_requested',
      jsonb_build_object('external_order_id',l.external_id,'test',m.test_only));
  return jsonb_build_object('status','requested','external_order_id',l.external_id,'merchant_id',l.merchant_id);
end $function$
;;
