
-- Estas RPCs jamais são concedidas ao motoboy. A leitura só pode ser feita
-- por gestor da mesma loja, usando is_store_manager que também cobre Super Admin.
create or replace function public.pitacco_fiado_toggle(p_store uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not public.is_store_manager(p_store) then
  raise exception 'Acesso exclusivo do gestor da loja' using errcode='42501';
 end if;
 insert into public.pitacco_fiado_settings(store_id,enabled)
 values(p_store,coalesce(p_enabled,false))
 on conflict(store_id) do update set enabled=excluded.enabled,updated_at=now();
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,auth.uid(),'fiado_settings_changed',
  jsonb_build_object('enabled',coalesce(p_enabled,false)));
 return coalesce(p_enabled,false);
end $$;

create or replace function public.pitacco_fiado_save_customer(
 p_store uuid,p_name text,p_phone text,p_limit numeric,p_enabled boolean,
 p_due_days integer default 7,p_mode text default 'automatic',
 p_block_overdue boolean default true
)
returns uuid language plpgsql security definer set search_path='' as $$
declare account_id uuid; normalized text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente o gestor pode autorizar fiado' using errcode='42501';end if;
 normalized:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if length(normalized) not between 10 and 13 or length(trim(coalesce(p_name,''))) not between 2 and 120 then
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

-- Um código de 10 dígitos é exibido APENAS nesta resposta ao gestor.
-- Armazenamos somente SHA-256 com salt por cliente, nunca o código.
create or replace function public.pitacco_fiado_rotate_code(p_store uuid,p_customer uuid)
returns text language plpgsql security definer set search_path='' as $$
declare client public.pitacco_fiado_customers%rowtype;
 pass text; seed bigint;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestor pode gerar código de fiado' using errcode='42501';end if;
 select * into client from public.pitacco_fiado_customers where id=p_customer
  and store_id=p_store for update;
 if not found then raise exception 'Cliente não cadastrado nesta loja' using errcode='22023';end if;
 seed:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,12))::bit(48)::bigint;
 pass:=lpad((seed%10000000000)::text,10,'0');
 update public.pitacco_fiado_customers
  set credential_hash=encode(sha256(convert_to(credential_salt||pass,'UTF8')),'hex'),
      credential_bad_attempts=0,credential_locked_until=null,updated_at=now()
  where id=client.id;
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,auth.uid(),'fiado_code_rotated',jsonb_build_object('customer',client.id));
 return pass;
end $$;

create or replace function public.pitacco_fiado_overview(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestor pode acessar a caderneta' using errcode='42501';end if;
 return jsonb_build_object(
 'enabled',coalesce((select enabled from public.pitacco_fiado_settings where store_id=p_store),false),
 'customers',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'phone',c.phone,'enabled',c.enabled,'limit',c.credit_limit,
    'used',c.used,'available',greatest(0,c.credit_limit-c.used),
    'due_days',c.due_days,'approval_mode',c.approval_mode,
    'block_overdue',c.block_overdue,'code_issued',c.credential_hash is not null,
    'overdue',exists(select 1 from public.pitacco_fiado_charges d
       where d.customer_id=c.id and d.store_id=p_store and d.state='open'
         and d.due_at<now() and d.amount>d.paid)
  ) order by c.name) from public.pitacco_fiado_customers c
  where c.store_id=p_store),'[]'::jsonb),
 'charges',coalesce((select jsonb_agg(jsonb_build_object(
     'order_id',d.order_id,'customer_id',d.customer_id,'amount',d.amount,'paid',d.paid,
     'state',d.state,'due_at',d.due_at,'approved',d.approved_at is not null,
     'approval_required',d.approval_required,'created_at',d.created_at
    ) order by d.created_at desc)
    from public.pitacco_fiado_charges d where d.store_id=p_store),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'customer_id',p.customer_id,'amount',p.amount,'method',p.method,
    'created_at',p.created_at,'note',p.note
   ) order by p.created_at desc) from public.pitacco_fiado_payments p
   where p.store_id=p_store),'[]'::jsonb));
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
 else
  update public.orders set status='rejected'
  where id=p_order and store_id=p_store and status='pending';
  if not found then raise exception 'Pedido já avançou de etapa' using errcode='22023';end if;
 end if;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(p_store,p_order,auth.uid(),'fiado_approval_decision',
  jsonb_build_object('approved',p_approve));
 return true;
end $$;

create or replace function public.pitacco_fiado_receive(
 p_store uuid,p_customer uuid,p_amount numeric,p_method text,p_request uuid,p_note text default ''
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare client public.pitacco_fiado_customers%rowtype;
 p_id uuid; charge record; remain numeric; allocated numeric; total_open numeric;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestor registra recebimentos' using errcode='42501';end if;
 if p_request is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2)
  or p_method not in ('pix','dinheiro','cartao','outro') or length(coalesce(p_note,''))>500 then
  raise exception 'Dados de recebimento inválidos' using errcode='22023';end if;
 -- Guardar idempotência também em repetição de requisições.
 select * into client from public.pitacco_fiado_customers where store_id=p_store
 and id=p_customer for update;
 if not found then raise exception 'Cliente não pertence a esta loja' using errcode='42501';end if;
 select id into p_id from public.pitacco_fiado_payments
  where store_id=p_store and request_id=p_request;
 if found then
  if not exists(select 1 from public.pitacco_fiado_payments
   where id=p_id and customer_id=p_customer and amount=p_amount and method=p_method) then
   raise exception 'Identificador reutilizado com dados diferentes';end if;
  return jsonb_build_object('payment_id',p_id,'remaining',client.used,'duplicate',true);
 end if;
 select coalesce(sum(amount-paid),0) into total_open
 from public.pitacco_fiado_charges where store_id=p_store and customer_id=p_customer and state='open';
 if p_amount>total_open then raise exception 'Valor superior ao saldo exigível' using errcode='22023';end if;
 insert into public.pitacco_fiado_payments(store_id,customer_id,request_id,amount,method,note,recorded_by)
 values(p_store,p_customer,p_request,p_amount,p_method,coalesce(p_note,''),auth.uid()) returning id into p_id;
 remain:=p_amount;
 for charge in select * from public.pitacco_fiado_charges
  where store_id=p_store and customer_id=p_customer and state='open'
    and amount>paid order by due_at,created_at for update loop
  exit when remain<=0;
  allocated:=least(remain,charge.amount-charge.paid);
  update public.pitacco_fiado_charges set paid=paid+allocated,
   state=case when paid+allocated>=amount then 'settled' else 'open' end,
   updated_at=now() where order_id=charge.order_id;
  insert into public.pitacco_fiado_allocations(payment_id,order_id,amount)
   values(p_id,charge.order_id,allocated);
  remain:=remain-allocated;
 end loop;
 if remain<>0 then raise exception 'Não foi possível distribuir o recebimento';end if;
 update public.pitacco_fiado_customers
 set used=used-p_amount,updated_at=now() where id=p_customer;
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,auth.uid(),'fiado_payment_received',
  jsonb_build_object('customer',p_customer,'payment',p_id,
     'amount',p_amount,'method',p_method));
 return jsonb_build_object('payment_id',p_id,'remaining',client.used-p_amount,'duplicate',false);
end $$;

revoke all on function public.pitacco_fiado_toggle(uuid,boolean) from public,anon;
revoke all on function public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) from public,anon;
revoke all on function public.pitacco_fiado_rotate_code(uuid,uuid) from public,anon;
revoke all on function public.pitacco_fiado_overview(uuid) from public,anon;
revoke all on function public.pitacco_fiado_approve(uuid,uuid,boolean) from public,anon;
revoke all on function public.pitacco_fiado_receive(uuid,uuid,numeric,text,uuid,text) from public,anon;
grant execute on function public.pitacco_fiado_toggle(uuid,boolean) to authenticated;
grant execute on function public.pitacco_fiado_save_customer(uuid,text,text,numeric,boolean,integer,text,boolean) to authenticated;
grant execute on function public.pitacco_fiado_rotate_code(uuid,uuid) to authenticated;
grant execute on function public.pitacco_fiado_overview(uuid) to authenticated;
grant execute on function public.pitacco_fiado_approve(uuid,uuid,boolean) to authenticated;
grant execute on function public.pitacco_fiado_receive(uuid,uuid,numeric,text,uuid,text) to authenticated;
