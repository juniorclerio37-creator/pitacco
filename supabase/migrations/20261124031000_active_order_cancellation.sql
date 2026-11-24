-- Manager-initiated cancellation of an active own order, never a courier action.
create or replace function public.pitacco_cancel_active_order(p_order uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
 reason text:=public.dg_clean_text(btrim(coalesce(p_reason,'')));
begin
 if auth.uid() is null or char_length(reason) not between 3 and 240 then
  raise exception 'Informe o motivo do cancelamento';
 end if;
 select * into o from public.orders where id=p_order and public.is_store_manager(store_id)
 and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='entregador') for update;
 if not found then raise exception 'Sem autorização para cancelar este pedido' using errcode='42501';end if;
 if o.source<>'proprio' then raise exception 'Use o cancelamento oficial da plataforma';end if;
 if o.status='cancelled' then return;end if;
 perform 1 from public.deliveries where order_id=o.id and store_id=o.store_id for update;
 if o.status not in ('pending','accepted') or o.preparation_status='completed' or
 exists(select 1 from public.deliveries where order_id=o.id and store_id=o.store_id and status='entregue')
 then raise exception 'Pedido já finalizado ou fora de andamento';end if;
 if exists(select 1 from public.deliveries where order_id=o.id and store_id=o.store_id and logistics_provider='marketplace' and status<>'cancelada')
 then raise exception 'Confirme o cancelamento da entrega parceira antes de cancelar o pedido';end if;
 -- Existing triggers cancel the own delivery, release unpaid Fiado and reverse loyalty.
 -- Payments remain recorded; no refund or restocking is assumed.
 update public.orders set status='cancelled' where id=o.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(o.store_id,o.id,auth.uid(),'order_cancelled',jsonb_build_object('reason',reason,'previous_status',o.status,'previous_preparation',o.preparation_status,'refund_review_required',true));
end $$;
revoke all on function public.pitacco_cancel_active_order(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_cancel_active_order(uuid,text) to authenticated;

create or replace function public.pitacco_ifood_manual_access(p_order uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
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
     and (test_only or (select merchant_linking from pitacco_private.ifood_control limit 1));
 if not found then raise exception 'Vínculo iFood não autorizado'; end if;
 if (o.receipt->>'ifood_test')::boolean is distinct from m.test_only then
   raise exception 'Ambiente iFood não corresponde à loja';
 end if;
 select * into pref from public.acceptance_settings where store_id=o.store_id and source='ifood';
 -- Acceptance remains guarded by pitacco_ifood_manual_request. Cancellation is independent of acceptance mode.
 return jsonb_build_object('external_order_id',l.external_id,'merchant_id',m.merchant_id,
   'accept_pending',o.receipt->>'ifood_manual_accept'='requested',
   'cancel_pending',o.receipt->>'ifood_manual_cancel'='requested');
end $$;

create or replace function public.pitacco_ifood_manual_cancel_request(p_order uuid,p_actor uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
        l pitacco_private.ifood_order_links%rowtype;
        permission jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Acesso exclusivo à integração autenticada' using errcode='42501'; end if;
 if p_reason is null or p_reason !~ '^[0-9]{2,6}$' then raise exception 'Motivo de cancelamento inválido'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found or o.status not in ('pending','accepted') or o.source<>'ifood' then raise exception 'Pedido não está pendente'; end if;
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

create or replace function public.pitacco_ifood_manual_cancel_failure(p_order uuid,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Acesso exclusivo ao servidor' using errcode='42501'; end if;
 select store_id into s from public.orders
 where id=p_order and source='ifood' and status in ('pending','accepted')
   and receipt->>'ifood_manual_cancel'='requested' for update;
 if not found then return; end if;
 update public.orders set receipt=receipt||
   jsonb_build_object('ifood_manual_cancel','failed','ifood_manual_cancel_error',
     pg_catalog.left(coalesce(p_error,'Erro iFood'),120)) where id=p_order;
 insert into public.operation_audit(store_id,order_id,action,details)
 values(s,p_order,'ifood_manual_cancel_failed',
   jsonb_build_object('error_category',pg_catalog.left(coalesce(p_error,'unknown'),60)));
end $$;
