-- Manual iFood confirmation: isolated from automatic acceptance and own orders.
-- The iFood API request itself runs only inside an authenticated Supabase Edge Function.

create or replace function public.pitacco_ifood_manual_request(p_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
  l pitacco_private.ifood_order_links%rowtype;
  m pitacco_private.ifood_merchants%rowtype;
  req public.marketplace_acceptance_requests%rowtype;
  pref public.acceptance_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta Pitacco' using errcode='42501'; end if;
  select * into o from public.orders where id=p_order for update;
  if not found or o.source <> 'ifood' then raise exception 'Pedido iFood não encontrado'; end if;
  if not exists (
    select 1 from public.store_members sm
    where sm.store_id=o.store_id and sm.user_id=auth.uid() and sm.role in ('lojista','gestor')
  ) and not (public.pitacco_is_platform_owner() and o.receipt->>'ifood_test' = 'true') then
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
    values(o.store_id,p_order,auth.uid(),'ifood_manual_accept_requested',
      jsonb_build_object('external_order_id',l.external_id,'test',m.test_only));
  return jsonb_build_object('status','requested','external_order_id',l.external_id,'merchant_id',l.merchant_id);
end $$;

revoke all on function public.pitacco_ifood_manual_request(uuid) from public,anon;
grant execute on function public.pitacco_ifood_manual_request(uuid) to authenticated;

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
