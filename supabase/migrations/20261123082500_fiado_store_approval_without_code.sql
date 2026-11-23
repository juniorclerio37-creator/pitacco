-- Fiado pelo celular: a aprovação é da própria loja.
-- Modo manual padrão para novos clientes; escolhas anteriores não são alteradas.
alter table public.pitacco_fiado_customers alter column approval_mode set default 'manual';
create or replace function public.pitacco_fiado_save_customer(
 p_store uuid,p_name text,p_phone text,p_limit numeric,p_enabled boolean,
 p_due_days integer default 7,p_mode text default 'manual',
 p_block_overdue boolean default true
)
returns uuid language plpgsql security definer set search_path='' as $$
declare account_id uuid; normalized text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente o gestor pode autorizar fiado' using errcode='42501';end if;
 normalized:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if left(normalized,2)='55' and length(normalized) in (12,13) then normalized:=substr(normalized,3);end if;
 if normalized !~ '^[0-9]{10,11}
  raise exception 'Informe nome e telefone completos' using errcode='22023';end if;
 if p_limit is null or p_limit < 0 or p_limit>100000 or p_limit<>round(p_limit,2) then
  raise exception 'Limite inválido' using errcode='22023';end if;
 if p_due_days not between 1 and 365 or p_mode not in ('automatic','manual') then
  raise exception 'Prazo ou aprovação inválidos' using errcode='22023';end if;
 insert into public.pitacco_fiado_customers
 (store_id,name,phone,credit_limit,enabled,due_days,approval_mode,block_overdue)
 values(p_store,trim(p_name),normalized,p_limit,coalesce(p_enabled,false),p_due_days,p_mode,coalesce(p_block_overdue,true))
 on conflict(store_id,phone) do update
 set name=excluded.name,credit_limit=excluded.credit_limit,enabled=excluded.enabled,
 due_days=excluded.due_days,approval_mode=excluded.approval_mode,
 block_overdue=excluded.block_overdue,updated_at=now()
 where public.pitacco_fiado_customers.used<=excluded.credit_limit
 returning id into account_id;
 if account_id is null then raise exception 'O limite não pode ficar abaixo do valor utilizado' using errcode='22023';end if;
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,auth.uid(),'fiado_customer_updated',
  jsonb_build_object('customer',account_id,'limit',p_limit,'enabled',p_enabled,
     'due_days',p_due_days,'approval_mode',p_mode));
 return account_id;
end $$;
create or replace function public.pitacco_fiado_approve(p_store uuid,p_order uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare charge public.pitacco_fiado_charges%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestor autoriza fiado' using errcode='42501';end if;
 select * into charge from public.pitacco_fiado_charges
  where store_id=p_store and order_id=p_order for update;
 if not found or charge.state<>'reserved' or not charge.approval_required or charge.approved_at is not null then
  raise exception 'Pedido não possui aprovação pendente' using errcode='22023';end if;
 if p_approve then
  update public.pitacco_fiado_charges set approved_at=now(),updated_at=now()
  where order_id=p_order;
  update public.orders set receipt=receipt||jsonb_build_object('fiado_approval','approved')
   where id=p_order and store_id=p_store and status='pending';
  if not found then raise exception 'Pedido já avançou de etapa' using errcode='22023';end if;
 else
  update public.orders set status='rejected',receipt=receipt||jsonb_build_object('fiado_approval','rejected')
  where id=p_order and store_id=p_store and status='pending';
  if not found then raise exception 'Pedido já avançou de etapa' using errcode='22023';end if;
 end if;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(p_store,p_order,auth.uid(),'fiado_approval_decision',
  jsonb_build_object('approved',p_approve));
 return true;
end $$;
create or replace function public.pitacco_fiado_checkout_status(
 p_slug text, p_phone text, p_order_total numeric
) returns jsonb language plpgsql stable security definer set search_path=''
as $fiado$
declare
 sid uuid;
 account public.pitacco_fiado_customers%rowtype;
 v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 v_blocked boolean:=false;
begin
 if v_phone !~ '^[0-9]{10,11}$' then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 select m.store_id into sid
 from public.public_menu_settings m
 join public.pitacco_fiado_settings f on f.store_id=m.store_id
 where m.slug=p_slug and m.enabled and f.enabled limit 1;
 if sid is null then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 select * into account from public.pitacco_fiado_customers c
 where c.store_id=sid and c.phone=v_phone and c.enabled limit 1;
 if not found then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 v_blocked:=
   (
     account.block_overdue and exists (
      select 1 from public.pitacco_fiado_charges d
      where d.customer_id=account.id and d.store_id=sid
        and d.state='open' and d.amount>d.paid and d.due_at<now()
     )
   )
   or coalesce(p_order_total,0)<=0
   or p_order_total>10000
   or p_order_total>greatest(0,account.credit_limit-account.used);

 return jsonb_build_object(
  'visible',true,
  'enabled',not v_blocked,
  'message',case when v_blocked then
   'Fiado indisponível para este pedido. Escolha outra forma de pagamento ou fale com a loja.'
   else null end
 );
end $fiado$;
create or replace function public.pitacco_fiado_phone_eligibility(
  p_slug text, p_phone text
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $fiado$
declare
  sid uuid;
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  allowed boolean := false;
begin
  if v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('eligible',false);
  end if;

  select m.store_id into sid
  from public.public_menu_settings m
  join public.pitacco_fiado_settings f
    on f.store_id=m.store_id and f.enabled
  where m.slug=p_slug and m.enabled
  limit 1;

  if sid is null then
    return jsonb_build_object('eligible',false);
  end if;

  select exists(
    select 1 from public.pitacco_fiado_customers c
    where c.store_id=sid and c.phone=v_phone
      and c.enabled
      and c.credit_limit>c.used
      and not (
        c.block_overdue and exists (
          select 1 from public.pitacco_fiado_charges d
          where d.store_id=sid and d.customer_id=c.id
            and d.state='open' and d.amount>d.paid and d.due_at<now()
        )
      )
  ) into allowed;

  return jsonb_build_object('eligible',coalesce(allowed,false));
end
$fiado$;
create or replace function public.pitacco_checkout_fiado(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,
 p_items jsonb,p_fulfillment text,p_notes text,p_code text default null,
 p_quote uuid default null,p_scheduled_for timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $fiado$
declare sid uuid; account public.pitacco_fiado_customers%rowtype;
 data jsonb; approval text; v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null then return jsonb_build_object('error','Fiado indisponível nesta loja');end if;
 if left(v_phone,2)='55' and length(v_phone) in (12,13) then v_phone:=substr(v_phone,3);end if;
 if v_phone !~ '^[0-9]{10,11}$' then return jsonb_build_object('error','Telefone inválido');end if;
 if not coalesce((select f.enabled from public.pitacco_fiado_settings f where f.store_id=sid),false)
 then return jsonb_build_object('error','Fiado indisponível nesta loja');end if;
 select * into account from public.pitacco_fiado_customers
  where store_id=sid and phone=v_phone and enabled for update;
 if not found then return jsonb_build_object('error','Fiado não autorizado para este telefone');end if;
 -- O limite e o valor real são validados no trigger do pedido, sob row lock.
 perform set_config('pitacco.fiado_customer',account.id::text,true);
 begin
  if p_quote is not null then
   data:=public.pitacco_checkout_quoted_delivery(p_slug,p_request,p_customer,v_phone,p_address,
    p_items,p_fulfillment,'fiado',p_notes,p_quote,p_scheduled_for);
  elsif p_scheduled_for is not null then
   data:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,v_phone,p_address,
    p_items,p_fulfillment,'fiado',p_notes,p_scheduled_for);
  else
   data:=public.checkout_public_order(p_slug,p_request,p_customer,v_phone,p_address,
    p_items,p_fulfillment,'fiado',p_notes);
  end if;
 exception when others then
  perform set_config('pitacco.fiado_customer','',true);
  raise;
 end;
 perform set_config('pitacco.fiado_customer','',true);
 select o.receipt->>'fiado_approval' into approval
 from public.orders o where o.id=(data->>'order_id')::uuid and o.store_id=sid;
 return coalesce(data,'{}'::jsonb)||
  jsonb_build_object('payment_status','fiado','fiado_approval',coalesce(approval,'pending'));
end $fiado$;
-- Chave antiga deixa de ser acessível à loja ou ao público.
revoke all on function public.pitacco_fiado_rotate_code(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pitacco_fiado_public_eligibility(text,text,text) from public,anon,authenticated;
revoke all on function public.pitacco_fiado_checkout_status(text,text,numeric) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_checkout_status(text,text,numeric) to anon,authenticated;
revoke all on function public.pitacco_fiado_phone_eligibility(text,text) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_phone_eligibility(text,text) to anon,authenticated;
revoke all on function public.pitacco_fiado_approve(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_approve(uuid,uuid,boolean) to authenticated;
revoke all on function public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) to authenticated;
revoke all on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) to anon,authenticated;
 or length(trim(coalesce(p_name,''))) not between 2 and 120 then
  raise exception 'Informe nome e telefone completos' using errcode='22023';end if;
 if p_limit is null or p_limit < 0 or p_limit>100000 or p_limit<>round(p_limit,2) then
  raise exception 'Limite inválido' using errcode='22023';end if;
 if p_due_days not between 1 and 365 or p_mode not in ('automatic','manual') then
  raise exception 'Prazo ou aprovação inválidos' using errcode='22023';end if;
 insert into public.pitacco_fiado_customers
 (store_id,name,phone,credit_limit,enabled,due_days,approval_mode,block_overdue)
 values(p_store,trim(p_name),normalized,p_limit,coalesce(p_enabled,false),p_due_days,p_mode,coalesce(p_block_overdue,true))
 on conflict(store_id,phone) do update
 set name=excluded.name,credit_limit=excluded.credit_limit,enabled=excluded.enabled,
 due_days=excluded.due_days,approval_mode=excluded.approval_mode,
 block_overdue=excluded.block_overdue,updated_at=now()
 where public.pitacco_fiado_customers.used<=excluded.credit_limit
 returning id into account_id;
 if account_id is null then raise exception 'O limite não pode ficar abaixo do valor utilizado' using errcode='22023';end if;
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,auth.uid(),'fiado_customer_updated',
  jsonb_build_object('customer',account_id,'limit',p_limit,'enabled',p_enabled,
     'due_days',p_due_days,'approval_mode',p_mode));
 return account_id;
end $$;
create or replace function public.pitacco_fiado_approve(p_store uuid,p_order uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare charge public.pitacco_fiado_charges%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestor autoriza fiado' using errcode='42501';end if;
 select * into charge from public.pitacco_fiado_charges
  where store_id=p_store and order_id=p_order for update;
 if not found or charge.state<>'reserved' or not charge.approval_required or charge.approved_at is not null then
  raise exception 'Pedido não possui aprovação pendente' using errcode='22023';end if;
 if p_approve then
  update public.pitacco_fiado_charges set approved_at=now(),updated_at=now()
  where order_id=p_order;
  update public.orders set receipt=receipt||jsonb_build_object('fiado_approval','approved')
   where id=p_order and store_id=p_store and status='pending';
  if not found then raise exception 'Pedido já avançou de etapa' using errcode='22023';end if;
 else
  update public.orders set status='rejected',receipt=receipt||jsonb_build_object('fiado_approval','rejected')
  where id=p_order and store_id=p_store and status='pending';
  if not found then raise exception 'Pedido já avançou de etapa' using errcode='22023';end if;
 end if;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(p_store,p_order,auth.uid(),'fiado_approval_decision',
  jsonb_build_object('approved',p_approve));
 return true;
end $$;
create or replace function public.pitacco_fiado_checkout_status(
 p_slug text, p_phone text, p_order_total numeric
) returns jsonb language plpgsql stable security definer set search_path=''
as $fiado$
declare
 sid uuid;
 account public.pitacco_fiado_customers%rowtype;
 v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 v_blocked boolean:=false;
begin
 if v_phone !~ '^[0-9]{10,11}$' then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 select m.store_id into sid
 from public.public_menu_settings m
 join public.pitacco_fiado_settings f on f.store_id=m.store_id
 where m.slug=p_slug and m.enabled and f.enabled limit 1;
 if sid is null then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 select * into account from public.pitacco_fiado_customers c
 where c.store_id=sid and c.phone=v_phone and c.enabled limit 1;
 if not found then
  return jsonb_build_object('visible',false,'enabled',false);
 end if;
 v_blocked:=
   (
     account.block_overdue and exists (
      select 1 from public.pitacco_fiado_charges d
      where d.customer_id=account.id and d.store_id=sid
        and d.state='open' and d.amount>d.paid and d.due_at<now()
     )
   )
   or coalesce(p_order_total,0)<=0
   or p_order_total>10000
   or p_order_total>greatest(0,account.credit_limit-account.used);

 return jsonb_build_object(
  'visible',true,
  'enabled',not v_blocked,
  'message',case when v_blocked then
   'Fiado indisponível para este pedido. Escolha outra forma de pagamento ou fale com a loja.'
   else null end
 );
end $fiado$;
create or replace function public.pitacco_fiado_phone_eligibility(
  p_slug text, p_phone text
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $fiado$
declare
  sid uuid;
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  allowed boolean := false;
begin
  if v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('eligible',false);
  end if;

  select m.store_id into sid
  from public.public_menu_settings m
  join public.pitacco_fiado_settings f
    on f.store_id=m.store_id and f.enabled
  where m.slug=p_slug and m.enabled
  limit 1;

  if sid is null then
    return jsonb_build_object('eligible',false);
  end if;

  select exists(
    select 1 from public.pitacco_fiado_customers c
    where c.store_id=sid and c.phone=v_phone
      and c.enabled
      and c.credit_limit>c.used
      and not (
        c.block_overdue and exists (
          select 1 from public.pitacco_fiado_charges d
          where d.store_id=sid and d.customer_id=c.id
            and d.state='open' and d.amount>d.paid and d.due_at<now()
        )
      )
  ) into allowed;

  return jsonb_build_object('eligible',coalesce(allowed,false));
end
$fiado$;
create or replace function public.pitacco_checkout_fiado(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,
 p_items jsonb,p_fulfillment text,p_notes text,p_code text default null,
 p_quote uuid default null,p_scheduled_for timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $fiado$
declare sid uuid; account public.pitacco_fiado_customers%rowtype;
 data jsonb; approval text; v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null then return jsonb_build_object('error','Fiado indisponível nesta loja');end if;
 if left(v_phone,2)='55' and length(v_phone) in (12,13) then v_phone:=substr(v_phone,3);end if;
 if v_phone !~ '^[0-9]{10,11}$' then return jsonb_build_object('error','Telefone inválido');end if;
 if not coalesce((select f.enabled from public.pitacco_fiado_settings f where f.store_id=sid),false)
 then return jsonb_build_object('error','Fiado indisponível nesta loja');end if;
 select * into account from public.pitacco_fiado_customers
  where store_id=sid and phone=v_phone and enabled for update;
 if not found then return jsonb_build_object('error','Fiado não autorizado para este telefone');end if;
 -- O limite e o valor real são validados no trigger do pedido, sob row lock.
 perform set_config('pitacco.fiado_customer',account.id::text,true);
 begin
  if p_quote is not null then
   data:=public.pitacco_checkout_quoted_delivery(p_slug,p_request,p_customer,v_phone,p_address,
    p_items,p_fulfillment,'fiado',p_notes,p_quote,p_scheduled_for);
  elsif p_scheduled_for is not null then
   data:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,v_phone,p_address,
    p_items,p_fulfillment,'fiado',p_notes,p_scheduled_for);
  else
   data:=public.checkout_public_order(p_slug,p_request,p_customer,v_phone,p_address,
    p_items,p_fulfillment,'fiado',p_notes);
  end if;
 exception when others then
  perform set_config('pitacco.fiado_customer','',true);
  raise;
 end;
 perform set_config('pitacco.fiado_customer','',true);
 select o.receipt->>'fiado_approval' into approval
 from public.orders o where o.id=(data->>'order_id')::uuid and o.store_id=sid;
 return coalesce(data,'{}'::jsonb)||
  jsonb_build_object('payment_status','fiado','fiado_approval',coalesce(approval,'pending'));
end $fiado$;
-- Chave antiga deixa de ser acessível à loja ou ao público.
revoke all on function public.pitacco_fiado_rotate_code(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pitacco_fiado_public_eligibility(text,text,text) from public,anon,authenticated;
revoke all on function public.pitacco_fiado_checkout_status(text,text,numeric) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_checkout_status(text,text,numeric) to anon,authenticated;
revoke all on function public.pitacco_fiado_phone_eligibility(text,text) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_phone_eligibility(text,text) to anon,authenticated;
revoke all on function public.pitacco_fiado_approve(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_approve(uuid,uuid,boolean) to authenticated;
revoke all on function public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) to authenticated;
revoke all on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) to anon,authenticated;
