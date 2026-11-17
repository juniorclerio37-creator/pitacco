-- Manual iFood confirmation: isolated from automatic acceptance and own orders.
-- The iFood API request itself runs only inside an authenticated Supabase Edge Function.

create or replace function public.pitacco_ifood_manual_request(p_order uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
      and (test_only or (select merchant_linking from pitacco_private.ifood_control limit 1))
    for share;
  if not found then raise exception 'Loja iFood indisponível para confirmação'; end if;
  if o.receipt->>'ifood_test' is distinct from case when m.test_only then 'true' else 'false' end
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
end $$;

revoke all on function public.pitacco_ifood_manual_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_manual_request(uuid,uuid) to service_role;

create or replace function public.pitacco_ifood_manual_failure(p_order uuid,p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Exclusivo do servidor' using errcode='42501'; end if;
  select store_id into s from public.orders where id=p_order and source='ifood' and status='pending';
  if not found then return; end if;
  update public.marketplace_acceptance_requests
    set state='rejected',provider_confirmation_id='manual-failed',
        provider_message=left(coalesce(p_code,'Falha no envio ao iFood'),180)
    where order_id=p_order and source='ifood' and state='requested';
  if found then
    update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||
      '{"ifood_manual_accept":"failed"}'::jsonb where id=p_order and status='pending';
    insert into public.operation_audit(store_id,order_id,action,details)
      values(s,p_order,'ifood_manual_accept_failed',
        jsonb_build_object('error_category',left(coalesce(p_code,'unknown'),60)));
  end if;
end $$;
revoke all on function public.pitacco_ifood_manual_failure(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_manual_failure(uuid,text) to service_role;

create or replace function public.pitacco_ifood_after_confirmed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source='ifood' and old.status='pending' and new.status='accepted'
    and new.receipt->>'ifood_status' in ('CONFIRMED','READY_TO_PICKUP','DISPATCHED','CONCLUDED') then
    update public.marketplace_acceptance_requests
      set state='confirmed',provider_confirmation_id='ifood-event',
          provider_message='Confirmação oficial recebida pelo iFood',confirmed_at=now()
      where order_id=new.id and source='ifood' and state='requested';
    insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,receipt,receipt_text)
      select new.store_id,new.id,s.sector,s.printer,s.width,n,
        new.receipt,
        public.dg_receipt_text(new.receipt||jsonb_build_object('number',
          coalesce(new.receipt->>'display_number',new.id::text),'source','ifood'))||
          'Setor: '||public.dg_clean_text(s.sector)||' Via: '||n||chr(10)
      from public.print_sectors s
      cross join lateral generate_series(1,s.copies) n
      where s.store_id=new.store_id and s.enabled
        and not exists (select 1 from public.print_jobs pj where pj.order_id=new.id and pj.sector=s.sector and pj.copy_no=n)
      on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists pitacco_ifood_after_confirmed_trigger on public.orders;
create trigger pitacco_ifood_after_confirmed_trigger
  after update of status on public.orders
  for each row when (old.status is distinct from new.status)
  execute function public.pitacco_ifood_after_confirmed();


-- All lookup/cancellation RPCs below are service_role-only and take the actor
-- identity from a validated Supabase auth/v1/user request in the Edge Function.
create or replace function public.pitacco_ifood_manual_access(p_order uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
        l pitacco_private.ifood_order_links%rowtype;
        m pitacco_private.ifood_merchants%rowtype;
        pref public.acceptance_settings%rowtype;
begin
 if auth.role()<>'service_role' or p_actor is null then raise exception 'Acesso exclusivo à integração autenticada' using errcode='42501'; end if;
 select * into o from public.orders where id=p_order;
 if not found or o.source<>'ifood' or o.status<>'pending' then raise exception 'Pedido não está pendente no iFood'; end if;
 if not exists(select 1 from public.store_members sm where sm.store_id=o.store_id and sm.user_id=p_actor and sm.role in ('gestor','lojista'))
   and not (exists(select 1 from pitacco_private.platform_owner po where po.user_id=p_actor) and o.receipt->>'ifood_test'='true')
 then raise exception 'Sem permissão para gerenciar este pedido' using errcode='42501'; end if;
 select * into l from pitacco_private.ifood_order_links where order_id=p_order;
 if not found or l.state_rank<>1 then raise exception 'Pedido não disponível para aceite ou recusa'; end if;
 select * into m from pitacco_private.ifood_merchants
   where merchant_id=l.merchant_id and store_id=o.store_id and enabled
     and (test_only or (select merchant_linking from pitacco_private.ifood_control limit 1));
 if not found then raise exception 'Vínculo iFood não autorizado'; end if;
 if o.receipt->>'ifood_test' is distinct from case when m.test_only then 'true' else 'false' end then
   raise exception 'Ambiente iFood não corresponde à loja';
 end if;
 select * into pref from public.acceptance_settings where store_id=o.store_id and source='ifood';
 if found and (not pref.enabled or pref.mode<>'manual') then raise exception 'Aceite manual não está ativo para esta loja'; end if;
 if not found and not m.test_only then raise exception 'Configure o aceite manual da loja'; end if;
 return jsonb_build_object('external_order_id',l.external_id,'merchant_id',m.merchant_id,
   'accept_pending',o.receipt->>'ifood_manual_accept'='requested',
   'cancel_pending',o.receipt->>'ifood_manual_cancel'='requested');
end $$;
revoke all on function public.pitacco_ifood_manual_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_manual_access(uuid,uuid) to service_role;

create or replace function public.pitacco_ifood_manual_cancel_request(p_order uuid,p_actor uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
        l pitacco_private.ifood_order_links%rowtype;
        permission jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Acesso exclusivo à integração autenticada' using errcode='42501'; end if;
 if p_reason is null or p_reason !~ '^[0-9]{2,6}$' then raise exception 'Motivo de cancelamento inválido'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found or o.status<>'pending' or o.source<>'ifood' then raise exception 'Pedido não está pendente'; end if;
 -- Revalidate ownership and merchant after row locking, and prevent accept/cancel race.
 permission:=public.pitacco_ifood_manual_access(p_order,p_actor);
 if coalesce((permission->>'accept_pending')::boolean,false) then raise exception 'Aceite já enviado ao iFood'; end if;
 if coalesce((permission->>'cancel_pending')::boolean,false) then
   return jsonb_build_object('status','already_requested');
 end if;
 if exists(select 1 from public.marketplace_acceptance_requests r
    where r.order_id=p_order and r.source='ifood' and r.state='requested')
 then raise exception 'Aceite já solicitado ao marketplace'; end if;
 update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||
   jsonb_build_object('ifood_manual_cancel','requested','ifood_manual_cancel_reason',p_reason)
 where id=p_order;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(o.store_id,p_order,p_actor,'ifood_manual_cancel_requested',
   jsonb_build_object('reason',p_reason,'external_order_id',permission->>'external_order_id'));
 return jsonb_build_object('status','requested','external_order_id',permission->>'external_order_id',
   'merchant_id',permission->>'merchant_id');
end $$;
revoke all on function public.pitacco_ifood_manual_cancel_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_manual_cancel_request(uuid,uuid,text) to service_role;

create or replace function public.pitacco_ifood_manual_cancel_failure(p_order uuid,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Acesso exclusivo ao servidor' using errcode='42501'; end if;
 select store_id into s from public.orders
 where id=p_order and source='ifood' and status='pending'
   and receipt->>'ifood_manual_cancel'='requested' for update;
 if not found then return; end if;
 update public.orders set receipt=receipt||
   jsonb_build_object('ifood_manual_cancel','failed','ifood_manual_cancel_error',
     pg_catalog.left(coalesce(p_error,'Erro iFood'),120)) where id=p_order;
 insert into public.operation_audit(store_id,order_id,action,details)
 values(s,p_order,'ifood_manual_cancel_failed',
   jsonb_build_object('error_category',pg_catalog.left(coalesce(p_error,'unknown'),60)));
end $$;
revoke all on function public.pitacco_ifood_manual_cancel_failure(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_manual_cancel_failure(uuid,text) to service_role;

-- Update the order only from the official event; an HTTP 202 is not a cancellation.
create or replace function public.pitacco_ifood_after_cancelled()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source='ifood' and new.status='cancelled'
   and old.status is distinct from new.status and new.receipt->>'ifood_status'='CANCELLED' then
   update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||
      '{"ifood_manual_cancel":"cancelled"}'::jsonb
    where id=new.id and receipt->>'ifood_manual_cancel'='requested';
   insert into public.operation_audit(store_id,order_id,action,details)
    values(new.store_id,new.id,'ifood_order_cancelled_official',
      jsonb_build_object('external_order_id',new.receipt->>'external_order_id'));
 end if;
 return new;
end $$;
drop trigger if exists pitacco_ifood_after_cancelled_trigger on public.orders;
create trigger pitacco_ifood_after_cancelled_trigger
 after update of status on public.orders
 for each row when (old.status is distinct from new.status)
 execute function public.pitacco_ifood_after_cancelled();

-- The stored iFood event processor currently ignores CARF. The following
-- migration must be paired with the updated webhook handler that enqueues CARF.
-- Preserve all existing handling and process the failed cancellation control event.
do $update_ifood_processor$
declare definition text;
begin
 select pg_get_functiondef(p.oid) into definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='pitacco_ifood_complete';
 if definition is null or position('  next_rank:=case e.code' in definition)=0 then
   raise exception 'iFood processor changed; manual cancellation migration requires review';
 end if;
 definition:=replace(definition,
   '  next_rank:=case e.code',
   $patch$  if e.code='CANCELLATION_REQUEST_FAILED' then
    update public.orders set receipt=coalesce(receipt,'{}'::jsonb)||
      '{"ifood_manual_cancel":"failed","ifood_manual_cancel_error":"O iFood não autorizou o cancelamento"}'::jsonb
    where id=link.order_id and source='ifood' and status='pending'
      and receipt->>'ifood_manual_cancel'='requested';
    update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
    return;
  end if;
  next_rank:=case e.code$patch$);
 execute definition;
end $update_ifood_processor$;
