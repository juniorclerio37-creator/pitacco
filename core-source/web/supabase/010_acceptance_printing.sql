-- DeliveryGestor Windows / shared web operations. Apply once after schema + 003..009.
-- Historical finance rows are deliberately not treated as incoming orders.
begin;
-- Normalize the 004/009 spelling mismatch before enabling acceptance->delivery.
alter table public.stores drop constraint if exists stores_dispatch_mode_check;
update public.stores set dispatch_mode='automatico' where dispatch_mode='automatica';
alter table public.stores add constraint stores_dispatch_mode_check check(dispatch_mode in ('manual','automatico','misto'));
create or replace function public.set_store_dispatch_mode(s uuid, mode text)
returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_store_manager(s) or mode not in ('manual','automatica','automatico','misto') then raise exception 'Nao autorizado'; end if;
 update public.stores set dispatch_mode=case when mode='automatica' then 'automatico' else mode end where id=s;
end $$;
create or replace function public.dispatch_delivery_on_insert() returns trigger
language plpgsql security definer set search_path='' as $$ declare chosen uuid; begin
 if new.logistics_provider<>'loja' or (select dispatch_mode from public.stores where id=new.store_id)<>'automatico' then return new; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.store_id::text,0));
 select c.id into chosen from public.couriers c where c.active and c.available and
 ((c.fleet_type='propria' and c.store_id=new.store_id and (select delivery_mode from public.stores where id=new.store_id) in ('propria','ambas'))
 or (c.fleet_type='compartilhada' and (select delivery_mode from public.stores where id=new.store_id) in ('compartilhada','ambas')))
 and not exists(select 1 from public.deliveries d where d.courier_id=c.id and d.status in ('atribuida','aceita','retirada'))
 order by c.created_at,c.id for update of c skip locked limit 1;
 if chosen is not null then update public.deliveries set courier_id=chosen,status='atribuida',updated_at=now() where id=new.id; end if;
 return new;
end $$;
alter table public.orders add column status text not null default 'historical' check(status in ('historical','pending','accepted'));
alter table public.orders add column source text not null default 'proprio' check(source in ('proprio','ifood','99food','keeta'));
alter table public.orders add column accepted_at timestamptz;
alter table public.orders add column accepted_by uuid references auth.users(id);
alter table public.orders add column receipt jsonb;
alter table public.orders add column request_id uuid;
create unique index orders_request_id_unique on public.orders(store_id,request_id) where request_id is not null;
update public.orders set source=case channel when 'iFood' then 'ifood' when '99Food' then '99food' else 'proprio' end;
-- Do not let a client insert a forged accepted order / official origin.
revoke insert,update,delete on public.orders from anon,authenticated;
grant insert(store_id,channel,gross,fees) on public.orders to authenticated;

create table public.acceptance_settings (
 store_id uuid references public.stores(id) on delete cascade,
 source text check(source in ('proprio','ifood','99food','keeta')),
 mode text not null default 'manual' check(mode in ('manual','automatic')),
 enabled boolean not null default true,
 primary key(store_id,source)
);
create table public.print_sectors (
 store_id uuid references public.stores(id) on delete cascade,
 sector text check(length(trim(sector)) between 1 and 80),
 printer text not null check(length(trim(printer)) between 1 and 200),
 width integer not null default 80 check(width in (58,80)),
 copies integer not null default 1 check(copies between 1 and 5),
 enabled boolean not null default true,
 primary key(store_id,sector)
);
create table public.print_devices (
 store_id uuid primary key references public.stores(id),
 device_id uuid not null,
 bound_by uuid references auth.users(id), bound_at timestamptz not null default now()
);
create table public.operation_audit (
 id bigint generated always as identity primary key,
 store_id uuid not null references public.stores(id),
 order_id uuid references public.orders(id),
 actor uuid references auth.users(id),
 action text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table public.print_jobs (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 order_id uuid not null references public.orders(id),
 sector text not null, printer text not null,
 width integer not null check(width in (58,80)),
 copy_no integer not null check(copy_no between 1 and 5),
 -- zero UUID is reserved for the initial, automatically generated print.
 request_id uuid not null default '00000000-0000-0000-0000-000000000000',
 receipt jsonb not null, receipt_text text not null,
 state text not null default 'pending' check(state in ('pending','claimed','saved','submitted','uncertain','error')),
 device_id uuid, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(order_id,sector,copy_no,request_id)
);
create index print_jobs_pending_idx on public.print_jobs(store_id,created_at) where state <> 'submitted';
create unique index delivery_order_once on public.deliveries(order_id) where order_id is not null;

alter table public.acceptance_settings enable row level security;
alter table public.print_sectors enable row level security;
alter table public.print_devices enable row level security;
alter table public.operation_audit enable row level security;
alter table public.print_jobs enable row level security;
create policy acceptance_manager on public.acceptance_settings for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
create policy sectors_manager on public.print_sectors for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
create policy devices_read on public.print_devices for select to authenticated using(public.is_store_manager(store_id));
create policy audit_read on public.operation_audit for select to authenticated using(public.is_store_manager(store_id));
create policy print_jobs_read on public.print_jobs for select to authenticated using(public.is_store_manager(store_id));
grant select,insert,update,delete on public.acceptance_settings,public.print_sectors to authenticated;
revoke all on public.print_devices,public.operation_audit,public.print_jobs from anon,authenticated;
grant select on public.print_devices,public.operation_audit,public.print_jobs to authenticated;

-- Only allow-listed display fields are copied. No delivery validation secrets.
create function public.dg_clean_text(value text) returns text
language sql immutable set search_path='' as $$
 select left(regexp_replace(coalesce(value,''),'[[:cntrl:]]',' ','g'),2000)
$$;
create function public.dg_receipt_text(r jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text; item jsonb; modifier jsonb;
begin
 result := 'DELIVERYGESTOR' || chr(10) || 'Pedido: ' || coalesce(r->>'number','') || chr(10)
 || 'Origem: ' || coalesce(r->>'source','') || chr(10) || 'Aceite: ' || coalesce(r->>'accepted_at','') || chr(10)
 || 'Cliente: ' || coalesce(r->>'customer','') || chr(10);
 for item in select value from jsonb_array_elements(r->'items') loop
   result := result || (item->>'quantity') || ' x ' || (item->>'name') || ' R$ ' || (item->>'unit_price') || chr(10);
   for modifier in select value from jsonb_array_elements(item->'modifiers') loop
     result := result || ' + ' || (modifier #>> '{}') || chr(10);
   end loop;
 end loop;
 return result || 'Observacoes: ' || coalesce(r->>'notes','') || chr(10)
 || 'Total: R$ ' || coalesce(r->>'total','0') || chr(10)
 || 'Pagamento: ' || coalesce(r->>'payment','') || chr(10)
 || 'Situacao: ' || coalesce(r->>'payment_status','nao confirmado') || chr(10)
 || 'Endereco: ' || coalesce(r->>'address','') || chr(10)
 || 'Logistica: ' || coalesce(r->>'logistics','') || chr(10);
end$$;

-- Private transaction primitive. Never granted to a client or exposed as an official marketplace confirmation.
create function public.dg_accept_own(p_order uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; r jsonb;
begin
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'Pedido inexistente'; end if;
 if o.source <> 'proprio' then raise exception 'Aceite bloqueado: integracao oficial ainda nao configurada'; end if;
 if o.status='accepted' then return o.id; end if;
 if o.status <> 'pending' or o.receipt is null then raise exception 'Pedido nao elegivel para aceite'; end if;
 r := o.receipt || jsonb_build_object('number',o.id,'source',o.source,'accepted_at',now());
 update public.orders set status='accepted',accepted_at=now(),accepted_by=auth.uid(),receipt=r where id=o.id;
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,receipt,receipt_text)
 select o.store_id,o.id,s.sector,s.printer,s.width,n,r,
  public.dg_receipt_text(r) || 'Setor: ' || public.dg_clean_text(s.sector) || ' Via: ' || n || chr(10)
 from public.print_sectors s cross join lateral generate_series(1,s.copies) n
 where s.store_id=o.store_id and s.enabled
 on conflict(order_id,sector,copy_no,request_id) do nothing;
 if r->>'logistics'='loja' then
  insert into public.deliveries(store_id,order_id,source,logistics_provider,customer_name,address,notes)
  values(o.store_id,o.id,'proprio','loja',r->>'customer',r->>'address',r->>'notes')
  on conflict(order_id) where order_id is not null do nothing;
 end if;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(o.store_id,o.id,auth.uid(),'accepted',jsonb_build_object('source','proprio','print_jobs',(select count(*) from public.print_jobs where order_id=o.id)));
 return o.id;
end$$;
create function public.accept_order(p_order uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 select store_id into s from public.orders where id=p_order;
 if s is null or not public.is_store_manager(s) then raise exception 'Sem permissao'; end if;
 return public.dg_accept_own(p_order);
end$$;

-- Authenticated manual own-order entry. This is NOT a public checkout or marketplace ingest endpoint.
create function public.create_operational_order(
 p_store uuid,p_request uuid,p_customer text,p_address text,p_items jsonb,p_total numeric,
 p_notes text default '',p_payment text default 'dinheiro',p_logistics text default 'loja'
) returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid; item jsonb; clean_items jsonb := '[]'; mods jsonb; total numeric := 0; q numeric; price numeric;
begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_request is null or length(trim(p_customer))=0 or p_customer is null or
 p_logistics not in ('loja','retirada') or p_logistics is null or
 (p_logistics='loja' and length(trim(coalesce(p_address,'')))=0) or
 jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Quantidade de itens invalida'; end if;
 -- Serialize retries before validating whether the operation already exists.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text || p_request::text,0));
 select id into oid from public.orders where store_id=p_store and request_id=p_request;
 if oid is not null then return oid; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  q := (item->>'quantity')::numeric; price := (item->>'unit_price')::numeric;
  if q is null or q < 1 or q > 1000 or q <> trunc(q) or price is null or price < 0 or price > 100000 or
  length(trim(coalesce(item->>'name','')))=0 then raise exception 'Item invalido'; end if;
  if jsonb_typeof(coalesce(item->'modifiers','[]')) <> 'array' then raise exception 'Complementos invalidos'; end if;
  if jsonb_array_length(coalesce(item->'modifiers','[]'))>50 or exists(select 1 from jsonb_array_elements(coalesce(item->'modifiers','[]')) x where jsonb_typeof(x)<>'string') then raise exception 'Complementos devem ser textos, no maximo 50'; end if;
  select coalesce(jsonb_agg(public.dg_clean_text(value #>> '{}')),'[]') into mods
   from jsonb_array_elements(coalesce(item->'modifiers','[]'));
  clean_items := clean_items || jsonb_build_array(jsonb_build_object('name',public.dg_clean_text(item->>'name'),'quantity',q,'unit_price',round(price,2),'modifiers',mods));
  total := total + q*round(price,2);
 end loop;
 if p_total is null or round(p_total,2)<>total then raise exception 'Total diferente da soma dos itens'; end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt)
 values(p_store,'Delivery próprio',total,'proprio','pending',p_request,
 jsonb_build_object('customer',public.dg_clean_text(p_customer),'address',public.dg_clean_text(p_address),
 'items',clean_items,'total',total,'notes',public.dg_clean_text(p_notes),'payment',public.dg_clean_text(p_payment),
 'payment_status','nao confirmado','logistics',p_logistics)) returning id into oid;
 if exists(select 1 from public.acceptance_settings where store_id=p_store and source='proprio' and mode='automatic' and enabled) then
   perform public.dg_accept_own(oid);
 end if;
 return oid;
end$$;

create function public.bind_print_device(p_store uuid,p_device uuid) returns void language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if not public.is_store_manager(p_store) or p_device is null then raise exception 'Sem permissao'; end if;
 perform 1 from public.stores where id=p_store for update;
 select device_id into existing from public.print_devices where store_id=p_store;
 if existing is not null and existing <> p_device then raise exception 'Loja vinculada a outro computador. Migracao requer conciliacao da fila pelo administrador'; end if;
 insert into public.print_devices(store_id,device_id,bound_by) values(p_store,p_device,auth.uid()) on conflict(store_id) do nothing;
end$$;
create function public.claim_print_jobs(p_store uuid,p_device uuid) returns setof public.print_jobs language plpgsql security definer set search_path='' as $$
begin
 if not public.is_store_manager(p_store) or not exists(select 1 from public.print_devices where store_id=p_store and device_id=p_device) then raise exception 'Dispositivo nao autorizado'; end if;
 with picked as (
  select id from public.print_jobs where store_id=p_store and state='pending' and device_id is null
  order by created_at,id for update skip locked limit 100
 ) update public.print_jobs j set device_id=p_device,state='claimed',updated_at=now()
 from picked where j.id=picked.id;
 return query select j.* from public.print_jobs j where j.store_id=p_store and j.device_id=p_device and j.state<>'submitted'
 order by (j.state in ('claimed','saved')) desc,j.created_at,j.id limit 100;
end$$;
create function public.ack_print_job(p_job uuid,p_device uuid,p_state text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare j public.print_jobs%rowtype;
begin
 select * into j from public.print_jobs where id=p_job for update;
 if not found or not public.is_store_manager(j.store_id) or j.device_id is distinct from p_device or
 not exists(select 1 from public.print_devices where store_id=j.store_id and device_id=p_device) then raise exception 'Sem permissao'; end if;
 if p_state not in ('saved','submitted','uncertain','error') or p_state is null then raise exception 'Estado invalido'; end if;
 if j.state='submitted' or (j.state=p_state and j.error is not distinct from left(p_error,1000)) then return; end if;
 -- Saved is an ingestion ACK, not permission to reset uncertain/sent work.
 if p_state='saved' and j.state not in ('claimed','saved') then return; end if;
 update public.print_jobs set state=p_state,error=left(p_error,1000),updated_at=now() where id=p_job;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(j.store_id,j.order_id,auth.uid(),'print_'||p_state,jsonb_build_object('job_id',j.id,'device_id',p_device,'error',left(p_error,1000)));
end$$;
create function public.reprint_order(p_order uuid,p_request uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.is_store_manager(o.store_id) then raise exception 'Sem permissao'; end if;
 if o.status <> 'accepted' or p_request is null or p_request='00000000-0000-0000-0000-000000000000'::uuid or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Reimpressao exige pedido aceito e motivo de pelo menos 5 caracteres'; end if;
 if exists(select 1 from public.print_jobs where order_id=o.id and request_id=p_request) then return; end if;
 if not exists(select 1 from public.print_sectors where store_id=o.store_id and enabled) then raise exception 'Configure ao menos uma impressora'; end if;
 insert into public.print_jobs(store_id,order_id,sector,printer,width,copy_no,request_id,receipt,receipt_text)
 select o.store_id,o.id,s.sector,s.printer,s.width,n,p_request,o.receipt,
 'REIMPRESSAO' || chr(10) || public.dg_receipt_text(o.receipt) || 'Setor: ' || public.dg_clean_text(s.sector) || ' Via: ' || n || chr(10)
 from public.print_sectors s cross join lateral generate_series(1,s.copies) n where s.store_id=o.store_id and s.enabled;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(o.store_id,o.id,auth.uid(),'reprint_requested',jsonb_build_object('request_id',p_request,'reason',public.dg_clean_text(p_reason)));
end$$;

revoke all on function public.dg_clean_text(text),public.dg_receipt_text(jsonb),public.dg_accept_own(uuid),
 public.accept_order(uuid),public.create_operational_order(uuid,uuid,text,text,jsonb,numeric,text,text,text),
 public.bind_print_device(uuid,uuid),public.claim_print_jobs(uuid,uuid),public.ack_print_job(uuid,uuid,text,text),public.reprint_order(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_order(uuid),public.create_operational_order(uuid,uuid,text,text,jsonb,numeric,text,text,text),
 public.bind_print_device(uuid,uuid),public.claim_print_jobs(uuid,uuid),public.ack_print_job(uuid,uuid,text,text),public.reprint_order(uuid,uuid,text) to authenticated;
-- Enable realtime without failing where an earlier setup already added a table.
do $$ declare t text; begin
 foreach t in array array['orders','print_jobs','deliveries'] loop
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
  execute format('alter publication supabase_realtime add table public.%I',t);
 end if;
 end loop;
end $$;
commit;
