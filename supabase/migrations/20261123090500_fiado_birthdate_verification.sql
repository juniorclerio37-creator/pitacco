-- Fiado: confirmar telefone e nascimento sem mostrar a data nem usar código particular.
-- Apenas o lojista cadastra/atualiza o verificador; o cliente informa a data
-- em cada checkout. Hash salgado; nenhuma data legível no ledger ou nas entregas.
alter table public.pitacco_fiado_customers
 add column if not exists birth_date_salt text not null default replace(gen_random_uuid()::text,'-',''),
 add column if not exists birth_date_hash text,
 add column if not exists birth_date_failed_attempts integer not null default 0,
 add column if not exists birth_date_locked_until timestamptz;

create table if not exists pitacco_private.fiado_birth_verifications (
 token uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 customer_id uuid not null references public.pitacco_fiado_customers(id) on delete cascade,
 request_id uuid not null,
 verified_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '5 minutes'),
 used_at timestamptz,
 order_id uuid
);
create index if not exists fiado_birth_verifications_lookup_idx
 on pitacco_private.fiado_birth_verifications(store_id,customer_id,request_id,expires_at);
revoke all on pitacco_private.fiado_birth_verifications from public,anon,authenticated;

-- A interface chama esta RPC nova, que preserva todas as regras de crédito existentes.
-- Data é obrigatória no cadastro novo e opcional em edições se já foi cadastrada.
create or replace function public.pitacco_fiado_save_customer_identity(
 p_store uuid,p_name text,p_phone text,p_limit numeric,p_enabled boolean,
 p_due_days integer,p_mode text,p_block_overdue boolean,p_birth_date text default null
) returns uuid language plpgsql security definer set search_path='' as $fiado$
declare cid uuid; bdate date; prior public.pitacco_fiado_customers%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente o gestor pode cadastrar os dados do cliente' using errcode='42501';end if;
 select * into prior from public.pitacco_fiado_customers
 where store_id=p_store
 and phone=case when regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') ~ '^55[0-9]{10,11}$'
      then substr(regexp_replace(p_phone,'[^0-9]','','g'),3)
      else regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') end
 for update;
 if coalesce(p_birth_date,'')='' and (not found or prior.birth_date_hash is null) then
  raise exception 'Informe a data de nascimento para autorizar compras fiadas' using errcode='22023';end if;
 if coalesce(p_birth_date,'')<>'' then
  if p_birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   raise exception 'Data de nascimento inválida' using errcode='22023';end if;
  begin bdate:=p_birth_date::date;
  exception when datetime_field_overflow or invalid_datetime_format then
   raise exception 'Data de nascimento inválida' using errcode='22023';
  end;
  if bdate < date '1900-01-01' or bdate > current_date then
   raise exception 'Data de nascimento inválida' using errcode='22023';end if;
 end if;
 cid:=public.pitacco_fiado_save_customer(p_store,p_name,p_phone,p_limit,p_enabled,p_due_days,p_mode,p_block_overdue);
 if bdate is not null then
  update public.pitacco_fiado_customers
   set birth_date_salt=replace(gen_random_uuid()::text,'-',''),
       birth_date_failed_attempts=0,birth_date_locked_until=null,updated_at=now()
   where id=cid and store_id=p_store;
  update public.pitacco_fiado_customers
   set birth_date_hash=encode(sha256(convert_to(birth_date_salt||':'||to_char(bdate,'YYYY-MM-DD'),'UTF8')),'hex')
   where id=cid and store_id=p_store;
  delete from pitacco_private.fiado_birth_verifications where store_id=p_store and customer_id=cid and used_at is null;
  insert into public.operation_audit(store_id,actor,action,details)
  values(p_store,auth.uid(),'fiado_birthdate_verifier_updated',jsonb_build_object('customer',cid));
 end if;
 return cid;
end $fiado$;
revoke all on function public.pitacco_fiado_save_customer_identity(uuid,text,text,numeric,boolean,integer,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.pitacco_fiado_save_customer_identity(uuid,text,text,numeric,boolean,integer,text,boolean,text)
 to authenticated;

-- A verificação incorrecta devolve um resultado, não uma exceção, para que
-- o contador de erros persista na transação sem registrar a data digitada.
create or replace function public.pitacco_fiado_verify_birthdate(
 p_slug text,p_phone text,p_birth_date text,p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $fiado$
declare sid uuid; acc public.pitacco_fiado_customers%rowtype; v_phone text; v_token uuid;
 verified boolean:=false; bdate date;
begin
 if p_request is null then return jsonb_build_object('verified',false,'message','Não foi possível validar os dados.');end if;
 v_phone:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if left(v_phone,2)='55' and length(v_phone) in (12,13) then v_phone:=substr(v_phone,3);end if;
 if v_phone !~ '^[0-9]{10,11}$' then return jsonb_build_object('verified',false,'message','Não foi possível validar os dados.');end if;
 select m.store_id into sid from public.public_menu_settings m
 join public.pitacco_fiado_settings f on f.store_id=m.store_id and f.enabled
 where m.slug=p_slug and m.enabled;
 if sid is null then return jsonb_build_object('verified',false,'message','Não foi possível validar os dados.');end if;
 select * into acc from public.pitacco_fiado_customers
  where store_id=sid and phone=v_phone and enabled for update;
 if not found or acc.birth_date_hash is null or coalesce(acc.birth_date_locked_until>now(),false) then
  return jsonb_build_object('verified',false,'message','Não foi possível validar os dados. Confira com a loja.');end if;
 if p_birth_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
  begin
   bdate:=p_birth_date::date;
   verified:=acc.birth_date_hash=
      encode(sha256(convert_to(acc.birth_date_salt||':'||to_char(bdate,'YYYY-MM-DD'),'UTF8')),'hex');
  exception when datetime_field_overflow or invalid_datetime_format then verified:=false;
  end;
 end if;
 if not verified then
  update public.pitacco_fiado_customers
   set birth_date_failed_attempts=case when birth_date_failed_attempts>=4 then 0 else birth_date_failed_attempts+1 end,
       birth_date_locked_until=case when birth_date_failed_attempts>=4 then now()+interval '30 minutes' else null end
   where id=acc.id;
  return jsonb_build_object('verified',false,'message','Não foi possível validar os dados. Confira com a loja.');
 end if;
 update public.pitacco_fiado_customers
  set birth_date_failed_attempts=0,birth_date_locked_until=null where id=acc.id;
 -- Um token aleatório de uso único é vinculado à loja, ao telefone e ao pedido.
 -- Não se transfere a data para outra RPC, receipt, pedido, log ou Fideliza+.
 insert into pitacco_private.fiado_birth_verifications(store_id,customer_id,request_id)
 values(sid,acc.id,p_request)
 returning token into v_token;
 return jsonb_build_object('verified',true,'token',v_token);
end $fiado$;
revoke all on function public.pitacco_fiado_verify_birthdate(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_verify_birthdate(text,text,text,uuid) to anon,authenticated;

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
    'block_overdue',c.block_overdue,'birth_date_set',c.birth_date_hash is not null,
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

-- Consulta pública mostra apenas se o modo está disponível, nunca a data.
-- Se a loja não registrou a data, o Fiado permanece desabilitado.
do $patch_status$
declare f regprocedure; definition text; old_text text;
begin
 f:='public.pitacco_fiado_checkout_status(text,text,numeric)'::regprocedure;
 definition:=pg_get_functiondef(f);
 old_text:='v_blocked:='||chr(10)||'   (';
 if strpos(definition,old_text)=0 then
  raise exception 'Status Fiado difere da versão esperada';
 end if;
 execute replace(definition,old_text,'v_blocked:='||chr(10)||'   account.birth_date_hash is null or (');
end $patch_status$;

-- Impedir checagem pública de telefones sem nascimento cadastrado.
do $patch_phone$
declare definition text; old_text text;
begin
 definition:=pg_get_functiondef('public.pitacco_fiado_phone_eligibility(text,text)'::regprocedure);
 old_text:='and c.enabled'||chr(10)||'      and c.credit_limit>c.used';
 if strpos(definition,old_text)=0 then
  raise exception 'Elegibilidade Fiado difere da versão esperada';
 end if;
 execute replace(definition,old_text,
  'and c.enabled'||chr(10)||'      and c.birth_date_hash is not null'||chr(10)||'      and c.credit_limit>c.used');
end $patch_phone$;

-- O argumento legada p_code passa a transportar SOMENTE o token temporário.
-- Não é código do cliente: o usuário vê e digita apenas telefone e nascimento.
create or replace function public.pitacco_checkout_fiado(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,
 p_items jsonb,p_fulfillment text,p_notes text,p_code text default null,
 p_quote uuid default null,p_scheduled_for timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $fiado$
declare sid uuid; account public.pitacco_fiado_customers%rowtype;
 data jsonb; approval text; v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 v_token uuid; confirmation pitacco_private.fiado_birth_verifications%rowtype;
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
  return jsonb_build_object('error','Confirme telefone e data de nascimento para usar Fiado');end if;
 begin v_token:=p_code::uuid;
 exception when invalid_text_representation then
  return jsonb_build_object('error','Confirme telefone e data de nascimento para usar Fiado');
 end;
 select * into confirmation from pitacco_private.fiado_birth_verifications
  where token=v_token and store_id=sid and customer_id=account.id and request_id=p_request for update;
 if not found then return jsonb_build_object('error','Confirme telefone e data de nascimento para usar Fiado');end if;
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
  return jsonb_build_object('error','Confirmação vencida. Informe novamente a data de nascimento');end if;
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
 update pitacco_private.fiado_birth_verifications
  set used_at=now(),order_id=(data->>'order_id')::uuid where token=confirmation.token;
 select o.receipt->>'fiado_approval' into approval
 from public.orders o where o.id=(data->>'order_id')::uuid and o.store_id=sid;
 return coalesce(data,'{}'::jsonb)||
  jsonb_build_object('payment_status','fiado','fiado_approval',coalesce(approval,'pending'));
end $fiado$;

-- Reforço das permissões: todas as operações de crédito continuam isoladas por loja.
revoke all on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) to anon,authenticated;
