-- Pitacco Entregador: arrival registration + terminal privacy + customer PIN.
-- Arrival is an operational event. It never marks a delivery complete.
alter table public.deliveries
  add column if not exists arrived_at timestamptz,
  add column if not exists arrival_provider_state text not null default 'none';
do $$
begin
 if not exists (select 1 from pg_constraint where conname='pitacco_arrival_provider_state_check') then
  alter table public.deliveries add constraint pitacco_arrival_provider_state_check
    check (arrival_provider_state in ('none','local','pending','submitted','confirmed','unavailable','failed'));
 end if;
end $$;

create or replace function public.pitacco_driver_arrive(p_delivery uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
 d public.deliveries%rowtype;
 v_source text;
 v_state text;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select src.* into d
 from public.deliveries src
 join public.couriers c on c.id=src.courier_id and c.store_id=src.store_id
 where src.id=p_delivery and c.active and c.user_id=(select auth.uid())
   and src.logistics_provider='loja'
 for update of src;
 if not found then raise exception 'Entrega não atribuída' using errcode='42501'; end if;
 if d.arrived_at is not null then
  return pg_catalog.jsonb_build_object('arrived_at',d.arrived_at,'provider_state',d.arrival_provider_state);
 end if;
 if d.status<>'retirada' or d.collected_at is null then
   raise exception 'Confirme a coleta e saída da loja antes da chegada' using errcode='22023';
 end if;
 v_source:=lower(coalesce(d.source,''));
 v_state:=case when v_source='ifood' then 'pending'
               when v_source in ('99food','keeta') then 'unavailable'
               else 'local' end;
 update public.deliveries
 set arrived_at=pg_catalog.now(),arrival_provider_state=v_state,updated_at=pg_catalog.now()
 where id=d.id returning * into d;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(d.store_id,d.order_id,(select auth.uid()),'courier_arrived',
    pg_catalog.jsonb_build_object('delivery',d.id,'source',v_source,'provider_state',v_state));
 if v_source='proprio' and d.order_id is not null
    and exists(select 1 from public.public_checkouts c where c.store_id=d.store_id and c.order_id=d.order_id) then
   insert into public.public_order_push_events(order_id,event_key,title,body)
   values(d.order_id,'courier_arrived','Seu entregador chegou',
          'O entregador chegou ao endereço. Confira o código de entrega para receber seu pedido.')
   on conflict(order_id,event_key) do nothing;
 end if;
 return pg_catalog.jsonb_build_object('arrived_at',d.arrived_at,'provider_state',v_state);
end
$function$;
revoke all on function public.pitacco_driver_arrive(uuid) from public,anon;
grant execute on function public.pitacco_driver_arrive(uuid) to authenticated;

-- Do not let courier SELECT completed deliveries with full address/name.
-- Merchant and owner retains the records, including for audits and support.
drop policy if exists delivery_select on public.deliveries;
create policy delivery_select on public.deliveries for select to authenticated using (
 public.is_admin()
 or (not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='entregador')
   and exists(select 1 from public.store_members sm where sm.store_id=deliveries.store_id
   and sm.user_id=(select auth.uid()) and sm.role in ('gestor','lojista')))
 or (deliveries.status not in ('entregue','cancelada')
  and (select public.pitacco_courier_session_ready())
  and exists(select 1 from public.couriers c where c.id=deliveries.courier_id
    and c.store_id=deliveries.store_id and c.user_id=(select auth.uid()) and c.active))
);

-- Prevent courier users who were also store members from reading orders.receipt directly.
drop policy if exists order_read on public.orders;
create policy order_read on public.orders for select to authenticated using (
  public.can_access_store(store_id)
  and not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='entregador')
);

-- Sanitized post-delivery history. No phone, receipt, customer name or full address.
create or replace function public.pitacco_driver_history(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare output jsonb;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 then
   raise exception 'Limite inválido' using errcode='22023'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'number',coalesce(public.pitacco_order_public_label(r.receipt,coalesce(r.source,d.source)),'Número indisponível'),
    'source',d.source,
    'completed_at',d.updated_at,
    'arrived_at',d.arrived_at,
    'amount',d.courier_payment,
    'initial',case when nullif(pg_catalog.btrim(d.customer_name),'') is null then 'C.'
               else pg_catalog.upper(pg_catalog.left(pg_catalog.btrim(d.customer_name),1))||'.' end,
    'address_hint',case when nullif(pg_catalog.btrim(d.address),'') is null then 'Endereço resumido indisponível'
       else pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(d.address,',',1)),8)||'…' end
   ) order by d.updated_at desc),'[]'::jsonb) into output
 from (
   select d.* from public.deliveries d
   join public.couriers c on c.id=d.courier_id and c.store_id=d.store_id
   where c.user_id=(select auth.uid()) and c.active and d.status='entregue'
     and d.logistics_provider='loja'
   order by d.updated_at desc limit p_limit
 ) d
 left join public.orders r on r.id=d.order_id and r.store_id=d.store_id;
 return output;
end $function$;
revoke all on function public.pitacco_driver_history(integer) from public,anon;
grant execute on function public.pitacco_driver_history(integer) to authenticated;

-- Store PINs used for direct (non-marketplace) deliveries:
-- no mobile/merchant direct table access. Customer obtains code through private tracking token.
create table if not exists public.pitacco_own_delivery_codes (
  delivery_id uuid primary key references public.deliveries(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  attempts integer not null default 0,
  created_at timestamptz not null default pg_catalog.now()
);
alter table public.pitacco_own_delivery_codes enable row level security;
revoke all on public.pitacco_own_delivery_codes from public,anon,authenticated;
grant select,insert,update,delete on public.pitacco_own_delivery_codes to service_role;
create or replace function pitacco_private.issue_own_delivery_code()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare n bigint;
begin
 if new.source='proprio' and new.logistics_provider='loja'
  and exists(select 1 from public.orders o where o.id=new.order_id and o.store_id=new.store_id and o.source='proprio') then
  n:=('x'||pg_catalog.encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 1000000;
  insert into public.pitacco_own_delivery_codes(delivery_id,store_id,code)
   values(new.id,new.store_id,pg_catalog.lpad(n::text,6,'0')) on conflict(delivery_id) do nothing;
 end if;
 return new;
end $function$;
drop trigger if exists pitacco_issue_own_delivery_code on public.deliveries;
create trigger pitacco_issue_own_delivery_code after insert on public.deliveries
 for each row execute function pitacco_private.issue_own_delivery_code();
insert into public.pitacco_own_delivery_codes(delivery_id,store_id,code)
select d.id,d.store_id,pg_catalog.lpad(
  (('x'||pg_catalog.encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 1000000)::text,6,'0')
from public.deliveries d join public.orders o on o.id=d.order_id and o.store_id=d.store_id
where d.source='proprio' and o.source='proprio' and d.logistics_provider='loja'
on conflict(delivery_id) do nothing;

-- Code verification and completion are atomic. Wrong code never completes order.
create or replace function public.pitacco_driver_verify_own_code(p_delivery uuid,p_code text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare d public.deliveries%rowtype; code_row public.pitacco_own_delivery_codes%rowtype;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão não autorizada' using errcode='42501'; end if;
 if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'Código de seis dígitos inválido' using errcode='22023'; end if;
 select src.* into d from public.deliveries src
  join public.couriers c on c.id=src.courier_id and c.store_id=src.store_id
  where src.id=p_delivery and c.user_id=(select auth.uid()) and c.active and src.source='proprio'
    and src.logistics_provider='loja'
  for update of src;
 if not found or d.status<>'retirada' or d.arrived_at is null then
  raise exception 'Registre primeiro a chegada ao cliente' using errcode='42501'; end if;
 select * into code_row from public.pitacco_own_delivery_codes
  where delivery_id=d.id and store_id=d.store_id for update;
 if not found then raise exception 'Código ainda não gerado' using errcode='22023'; end if;
 if code_row.attempts>=5 then raise exception 'Tentativas esgotadas; solicite ajuda à loja' using errcode='22023'; end if;
 if code_row.code<>p_code then
  update public.pitacco_own_delivery_codes set attempts=attempts+1 where delivery_id=d.id;
  -- Return a negative result rather than raising, so the attempt increment commits.
  return pg_catalog.jsonb_build_object('verified',false,'remaining',4-code_row.attempts);
 end if;
 update public.deliveries set delivery_code_verified_at=pg_catalog.now(),
  status='entregue', updated_at=pg_catalog.now() where id=d.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
  values(d.store_id,d.order_id,(select auth.uid()),'courier_delivery_verified',
   pg_catalog.jsonb_build_object('delivery',d.id,'mode','pitacco_customer_code'));
 return pg_catalog.jsonb_build_object('verified',true,'delivered',true);
end $function$;
revoke all on function public.pitacco_driver_verify_own_code(uuid,text) from public,anon;
grant execute on function public.pitacco_driver_verify_own_code(uuid,text) to authenticated;

-- An explicit delivery update, via any legacy function, must not bypass arrival + PIN.
create or replace function pitacco_private.require_courier_arrival_and_proof()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
 if new.status='entregue' and old.status<>'entregue'
    and new.logistics_provider='loja' and new.courier_id is not null then
  if new.arrived_at is null or new.delivery_code_verified_at is null then
   raise exception 'Chegada e código de entrega verificado são obrigatórios' using errcode='23514';
  end if;
 end if;
 return new;
end $function$;
drop trigger if exists pitacco_require_arrival_and_proof on public.deliveries;
create trigger pitacco_require_arrival_and_proof before update of status on public.deliveries
 for each row execute function pitacco_private.require_courier_arrival_and_proof();
