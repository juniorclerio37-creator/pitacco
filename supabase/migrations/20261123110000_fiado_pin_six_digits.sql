-- Substituir a data de nascimento por PIN de seis dígitos na autorização do Fiado.
-- Loja configura PIN pessoal em conjunto com cliente; painel nunca revela PIN após salvar.
-- A loja continua decidindo manual/automático por cliente, e o checkout continua
-- validando valores e reservando crédito transacionalmente.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.pitacco_fiado_customers
  add column if not exists pin_hash text,
  add column if not exists pin_failed_attempts integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- Tokens anteriores não comprovam conhecimento do novo PIN.
alter table pitacco_private.fiado_birth_verifications rename to fiado_pin_verifications;
update pitacco_private.fiado_pin_verifications
 set expires_at=now(), used_at=coalesce(used_at,now())
 where used_at is null;
alter index if exists pitacco_private.fiado_birth_verifications_lookup_idx
 rename to fiado_pin_verifications_lookup_idx;
revoke all on pitacco_private.fiado_pin_verifications from public,anon,authenticated;

-- Gestor cadastra PIN junto ao cliente ou redefine em caso de perda.
-- Em edições, ausência do PIN preserva hash anterior; cadastro novo exige PIN.
create or replace function public.pitacco_fiado_save_customer_pin(
 p_store uuid,p_name text,p_phone text,p_limit numeric,p_enabled boolean,
 p_due_days integer,p_mode text,p_block_overdue boolean,p_pin text default null
) returns uuid language plpgsql security definer set search_path='' as $pin$
declare cid uuid; old_hash text; normalized text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente o gestor pode cadastrar clientes do Fiado' using errcode='42501';end if;
 normalized:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if left(normalized,2)='55' and length(normalized) in (12,13) then normalized:=substr(normalized,3);end if;
 if normalized !~ '^[0-9]{10,11}$' then raise exception 'Telefone inválido' using errcode='22023';end if;
 select c.pin_hash into old_hash from public.pitacco_fiado_customers c
 where c.store_id=p_store and c.phone=normalized for update;
 if coalesce(p_pin,'')='' and old_hash is null then
  raise exception 'Informe um PIN pessoal de seis dígitos para este cliente' using errcode='22023';end if;
 if p_pin is not null and p_pin<>'' and p_pin !~ '^[0-9]{6}$' then
  raise exception 'O PIN precisa ter exatamente seis dígitos numéricos' using errcode='22023';end if;
 cid:=public.pitacco_fiado_save_customer(p_store,p_name,normalized,p_limit,p_enabled,p_due_days,p_mode,p_block_overdue);
 if coalesce(p_pin,'')<>'' then
  update public.pitacco_fiado_customers
   set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',11)),
       pin_failed_attempts=0,pin_locked_until=null,updated_at=now()
  where id=cid and store_id=p_store;
  delete from pitacco_private.fiado_pin_verifications where store_id=p_store and customer_id=cid and used_at is null;
  insert into public.operation_audit(store_id,actor,action,details)
   values(p_store,auth.uid(),'fiado_pin_verifier_updated',jsonb_build_object('customer',cid));
 end if;
 return cid;
end $pin$;
revoke all on function public.pitacco_fiado_save_customer_pin(uuid,text,text,numeric,boolean,integer,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.pitacco_fiado_save_customer_pin(uuid,text,text,numeric,boolean,integer,text,boolean,text)
 to authenticated;

-- Validação executada exclusivamente no banco; não registra PIN em pedidos.
-- Cinco erros seguidos suspendem novas confirmações por 30 minutos.
create or replace function public.pitacco_fiado_verify_pin(
 p_slug text,p_phone text,p_pin text,p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $pin$
declare sid uuid; account public.pitacco_fiado_customers%rowtype; phone text; v_token uuid;
begin
 if p_request is null then
  return jsonb_build_object('verified',false,'message','Não foi possível validar o Fiado. Confira os dados com a loja.');end if;
 phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if left(phone,2)='55' and length(phone) in (12,13) then phone:=substr(phone,3);end if;
 if phone !~ '^[0-9]{10,11}$' then
  return jsonb_build_object('verified',false,'message','Não foi possível validar o Fiado. Confira os dados com a loja.');end if;
 select m.store_id into sid from public.public_menu_settings m
 join public.pitacco_fiado_settings f on f.store_id=m.store_id and f.enabled
 where m.slug=p_slug and m.enabled limit 1;
 if sid is null then
  return jsonb_build_object('verified',false,'message','Não foi possível validar o Fiado. Confira os dados com a loja.');end if;
 select * into account from public.pitacco_fiado_customers c
 where c.store_id=sid and c.phone=phone and c.enabled for update;
 if not found or account.pin_hash is null or coalesce(account.pin_locked_until>now(),false) then
  return jsonb_build_object('verified',false,'message','Não foi possível validar o Fiado. Confira os dados com a loja.');end if;
 if p_pin is null or p_pin !~ '^[0-9]{6}$'
  or extensions.crypt(p_pin,account.pin_hash)<>account.pin_hash then
  update public.pitacco_fiado_customers c
  set pin_failed_attempts=case when c.pin_failed_attempts>=4 then 0 else c.pin_failed_attempts+1 end,
      pin_locked_until=case when c.pin_failed_attempts>=4 then now()+interval '30 minutes' else null end
  where c.id=account.id and c.store_id=sid;
  return jsonb_build_object('verified',false,'message','Não foi possível validar o Fiado. Confira os dados com a loja.');
 end if;
 update public.pitacco_fiado_customers
 set pin_failed_attempts=0,pin_locked_until=null where id=account.id and store_id=sid;
 insert into pitacco_private.fiado_pin_verifications(store_id,customer_id,request_id)
 values(sid,account.id,p_request) returning token into v_token;
 return jsonb_build_object('verified',true,'token',v_token);
end $pin$;
revoke all on function public.pitacco_fiado_verify_pin(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_verify_pin(text,text,text,uuid) to anon,authenticated;

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
    'block_overdue',c.block_overdue,'pin_set',c.pin_hash is not null,
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
   account.pin_hash is null or coalesce(account.pin_locked_until>now(),false) or (
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
      and c.pin_hash is not null
      and (c.pin_locked_until is null or c.pin_locked_until<=now())
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
 v_token uuid; confirmation pitacco_private.fiado_pin_verifications%rowtype;
 previous public.orders%rowtype; tracking uuid;
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null then return jsonb_build_object('error','Fiado indisponível nesta loja');end if;
 if left(v_phone,2)='55' and length(v_phone) in (12,13) then v_phone:=substr(v_phone,3);end if;
 if v_phone !~ '^[0-9]{10,11}$' then return jsonb_build_object('error','Telefone inválido');end if;
 if not coalesce((select f.enabled from public.pitacco_fiado_settings f where f.store_id=sid),false)
 then return jsonb_build_object('error','Fiado indisponível nesta loja');end if;
 select * into account from public.pitacco_fiado_customers
  where store_id=sid and phone=v_phone and enabled for update;
 if not found then return jsonb_build_object('error','Fiado não autorizado');end if;
 if p_request is null or coalesce(p_code,'') !~ '^[0-9a-fA-F-]{36}$' then
  return jsonb_build_object('error','Confirme telefone e PIN para usar Fiado');end if;
 begin v_token:=p_code::uuid;
 exception when invalid_text_representation then
  return jsonb_build_object('error','Confirme telefone e PIN para usar Fiado');
 end;
 select * into confirmation from pitacco_private.fiado_pin_verifications
  where token=v_token and store_id=sid and customer_id=account.id and request_id=p_request for update;
 if not found then return jsonb_build_object('error','Confirme telefone e PIN para usar Fiado');end if;
 if confirmation.used_at is not null then
  select * into previous from public.orders
  where id=confirmation.order_id and store_id=sid and request_id=p_request
   and receipt->>'payment'='fiado' and receipt->>'phone'=v_phone;
  if not found then return jsonb_build_object('error','Confirmação de Fiado já utilizada');end if;
  select tracking_token into tracking from public.public_checkouts
   where order_id=previous.id and store_id=sid;
  return jsonb_build_object('order_id',previous.id,'tracking_token',tracking,
   'total',previous.gross,'status',previous.status,'payment_status','fiado',
   'fiado_approval',previous.receipt->>'fiado_approval');
 end if;
 if confirmation.expires_at<now() then
  return jsonb_build_object('error','Confirmação vencida. Informe novamente seu PIN');end if;
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
 if data->>'order_id' is null then return data;end if;
 update pitacco_private.fiado_pin_verifications
  set used_at=now(),order_id=(data->>'order_id')::uuid where token=confirmation.token;
 select o.receipt->>'fiado_approval' into approval
 from public.orders o where o.id=(data->>'order_id')::uuid and o.store_id=sid;
 return coalesce(data,'{}'::jsonb)||
  jsonb_build_object('payment_status','fiado','fiado_approval',coalesce(approval,'pending'));
end $fiado$;

-- Remover APIs de nascimento e os campos antigos que não são mais necessários.
revoke all on function public.pitacco_fiado_verify_birthdate(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.pitacco_fiado_save_customer_identity(uuid,text,text,numeric,boolean,integer,text,boolean,text) from public,anon,authenticated;
drop function public.pitacco_fiado_verify_birthdate(text,text,text,uuid);
drop function public.pitacco_fiado_save_customer_identity(uuid,text,text,numeric,boolean,integer,text,boolean,text);
alter table public.pitacco_fiado_customers
 drop column if exists birth_date_salt,
 drop column if exists birth_date_hash,
 drop column if exists birth_date_failed_attempts,
 drop column if exists birth_date_locked_until;
