
-- Verificação de credencial privada: código nunca é retornado e falha não revela
-- se o telefone está cadastrado. A RPC de consulta não lança erro por PIN ruim:
-- isso permite persistir a contagem de tentativas na transação.
create or replace function pitacco_private.fiado_customer_access(
 p_store uuid,p_phone text,p_code text
) returns uuid language plpgsql security definer set search_path='' as $$
declare account public.pitacco_fiado_customers%rowtype;
 valid boolean;
begin
 if p_store is null or p_code is null or p_code !~ '^[0-9]{10}$' then return null;end if;
 if not coalesce((select enabled from public.pitacco_fiado_settings where store_id=p_store),false) then
  return null;end if;
 select * into account from public.pitacco_fiado_customers
  where store_id=p_store and phone=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
   for update;
 if not found then return null;end if;
 if account.credential_locked_until>now() or not account.enabled or account.credential_hash is null
   then return null;end if;
 valid:=account.credential_hash=encode(sha256(convert_to(account.credential_salt||p_code,'UTF8')),'hex');
 if not valid then
  update public.pitacco_fiado_customers set
   credential_bad_attempts=case when credential_bad_attempts>=4 then 0 else credential_bad_attempts+1 end,
   credential_locked_until=case when credential_bad_attempts>=4 then now()+interval '30 minutes' else null end
   where id=account.id;
  return null;
 end if;
 if account.credential_bad_attempts>0 then
  update public.pitacco_fiado_customers
   set credential_bad_attempts=0,credential_locked_until=null where id=account.id;
 end if;
 if account.credit_limit<=0 or account.used>=account.credit_limit then return null;end if;
 if account.block_overdue and exists(
  select 1 from public.pitacco_fiado_charges c where c.customer_id=account.id
    and c.state='open' and c.paid<c.amount and c.due_at<now()) then return null;end if;
 return account.id;
end $$;
revoke all on function pitacco_private.fiado_customer_access(uuid,text,text) from public,anon,authenticated;

create or replace function public.pitacco_fiado_public_eligibility(p_slug text,p_phone text,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; account public.pitacco_fiado_customers%rowtype;
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if not found then return jsonb_build_object('eligible',false);end if;
 cid:=pitacco_private.fiado_customer_access(sid,p_phone,p_code);
 if cid is null then return jsonb_build_object('eligible',false);end if;
 select * into account from public.pitacco_fiado_customers where id=cid;
 return jsonb_build_object('eligible',true,'available',greatest(0,account.credit_limit-account.used),
  'due_days',account.due_days,'approval_mode',account.approval_mode);
end $$;
revoke all on function public.pitacco_fiado_public_eligibility(text,text,text) from public;
grant execute on function public.pitacco_fiado_public_eligibility(text,text,text) to anon,authenticated;

-- Apenas o checkout com autorização transacional pode criar dívida fiada.
create or replace function pitacco_private.fiado_on_order_create()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; account public.pitacco_fiado_customers%rowtype;
begin
 if new.source<>'proprio' or new.receipt->>'payment'<>'fiado' then return new;end if;
 cid:=nullif(current_setting('pitacco.fiado_customer',true),'')::uuid;
 if cid is null then raise exception 'Fiado não autorizado para este pedido' using errcode='42501';end if;
 select * into account from public.pitacco_fiado_customers where id=cid and store_id=new.store_id for update;
 if not found or not account.enabled or account.credit_limit<=0 or
  account.phone is distinct from regexp_replace(coalesce(new.receipt->>'phone',''),'[^0-9]','','g')
  or not coalesce((select enabled from public.pitacco_fiado_settings where store_id=new.store_id),false)
  then raise exception 'Cliente não possui autorização para fiado' using errcode='42501';end if;
 if account.block_overdue and exists (
   select 1 from public.pitacco_fiado_charges c
    where c.customer_id=cid and c.state='open' and c.amount>c.paid and c.due_at<now())
  then raise exception 'Fiado bloqueado por dívida vencida' using errcode='22023';end if;
 if new.gross<=0 or new.gross>10000 or account.used+new.gross>account.credit_limit then
  raise exception 'Limite do fiado insuficiente para este pedido' using errcode='22023';end if;
 update public.pitacco_fiado_customers set used=used+new.gross,updated_at=now() where id=cid;
 new.receipt:=coalesce(new.receipt,'{}'::jsonb)||jsonb_build_object(
  'payment','fiado','payment_method','fiado','payment_status','fiado',
  'payment_on_delivery',false,'collect_on_delivery',false,
  'payment_timing','later','fiado_customer_id',cid,
  'fiado_approval',case when account.approval_mode='manual' then 'pending' else 'approved' end);
 return new;
end $$;
drop trigger if exists pitacco_fiado_before_order on public.orders;
create trigger pitacco_fiado_before_order before insert on public.orders
for each row execute function pitacco_private.fiado_on_order_create();

create or replace function pitacco_private.fiado_order_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare account public.pitacco_fiado_customers%rowtype;
begin
 if new.source<>'proprio' or new.receipt->>'payment'<>'fiado' then return new;end if;
 select * into account from public.pitacco_fiado_customers
  where id=(new.receipt->>'fiado_customer_id')::uuid and store_id=new.store_id;
 if not found then raise exception 'Conta do fiado não encontrada';end if;
 insert into public.pitacco_fiado_charges(order_id,store_id,customer_id,amount,due_at,
 approval_required,approved_at)
 values(new.id,new.store_id,account.id,new.gross,now()+make_interval(days=>account.due_days),
  account.approval_mode='manual',
  case when account.approval_mode='automatic' then now() else null end);
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(new.store_id,new.id,auth.uid(),'fiado_credit_reserved',
  jsonb_build_object('customer',account.id,'amount',new.gross,'due_at',now()+make_interval(days=>account.due_days)));
 return new;
end $$;
drop trigger if exists pitacco_fiado_after_order on public.orders;
create trigger pitacco_fiado_after_order after insert on public.orders
for each row execute function pitacco_private.fiado_order_record();

create or replace function pitacco_private.fiado_guard_order_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare charge public.pitacco_fiado_charges%rowtype;
begin
 if old.source<>'proprio' or old.receipt->>'payment'<>'fiado' then
  if new.receipt->>'payment'='fiado' then
   raise exception 'Fiado deve ser cadastrado no checkout autorizado' using errcode='42501';
  end if;
  return new;
 end if;
 if new.receipt->>'payment' is distinct from 'fiado'
    or new.receipt->>'fiado_customer_id' is distinct from old.receipt->>'fiado_customer_id'
    or new.receipt->>'payment_status' is distinct from old.receipt->>'payment_status' then
  raise exception 'Pagamento fiado é controlado somente pela caderneta' using errcode='42501';end if;
 if new.status='accepted' and old.status is distinct from new.status then
  select * into charge from public.pitacco_fiado_charges where order_id=new.id;
  if charge.approval_required and charge.approved_at is null then
   raise exception 'Aguarde aprovação manual do fiado antes de aceitar o pedido' using errcode='22023';end if;
 end if;
 return new;
end $$;
drop trigger if exists pitacco_fiado_guard_order_update on public.orders;
create trigger pitacco_fiado_guard_order_update before update of status,receipt on public.orders
for each row execute function pitacco_private.fiado_guard_order_update();

create or replace function pitacco_private.fiado_after_order_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare charge public.pitacco_fiado_charges%rowtype;
begin
 if new.source<>'proprio' or new.receipt->>'payment'<>'fiado' then return new;end if;
 if new.status in ('cancelled','rejected') and old.status is distinct from new.status then
  select * into charge from public.pitacco_fiado_charges where order_id=new.id for update;
  if found and charge.state not in ('cancelled','settled') then
   if charge.paid>0 then raise exception 'Estorne o fiado antes de cancelar o pedido' using errcode='22023';end if;
   update public.pitacco_fiado_charges set state='cancelled',updated_at=now() where order_id=new.id;
   update public.pitacco_fiado_customers set used=used-charge.amount,updated_at=now() where id=charge.customer_id;
  end if;
 end if;
 if new.preparation_status='completed' and old.preparation_status is distinct from new.preparation_status
   and new.receipt->>'logistics'='retirada' then
  update public.pitacco_fiado_charges set state='open',updated_at=now()
   where order_id=new.id and state='reserved';
 end if;
 return new;
end $$;
drop trigger if exists pitacco_fiado_after_order_change on public.orders;
create trigger pitacco_fiado_after_order_change after update of status,preparation_status on public.orders
for each row execute function pitacco_private.fiado_after_order_change();

create or replace function pitacco_private.fiado_delivery_completed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='entregue' and old.status is distinct from new.status and new.order_id is not null then
  update public.pitacco_fiado_charges set state='open',updated_at=now()
   where order_id=new.order_id and store_id=new.store_id and state='reserved';
 end if;
 return new;
end $$;
drop trigger if exists pitacco_fiado_delivery_completed on public.deliveries;
create trigger pitacco_fiado_delivery_completed after update of status on public.deliveries
for each row execute function pitacco_private.fiado_delivery_completed();
