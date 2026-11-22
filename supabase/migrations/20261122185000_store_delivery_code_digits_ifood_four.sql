-- Store determines the length of future customer delivery PINs.
-- Existing issued PINs retain their original length and remain valid.
-- iFood PINs are external, ALWAYS four digits; this table never changes iFood.
create table if not exists public.pitacco_store_delivery_code_settings(
 store_id uuid primary key references public.stores(id) on delete cascade,
 digits smallint not null default 6 check (digits between 4 and 8),
 updated_at timestamptz not null default now(),
 updated_by uuid
);
alter table public.pitacco_store_delivery_code_settings enable row level security;
revoke all on public.pitacco_store_delivery_code_settings from public, anon, authenticated;

-- Read a single store's choice only after checking manager membership.
create or replace function public.pitacco_store_delivery_code_length(p_store uuid)
returns integer
language plpgsql stable security definer
set search_path to ''
as $body$
begin
 if (select auth.uid()) is null or not public.is_store_manager(p_store) then
  raise exception 'Sem autorização para esta loja' using errcode='42501';
 end if;
 return coalesce((select s.digits::integer
  from public.pitacco_store_delivery_code_settings s where s.store_id=p_store),6);
end $body$;

create or replace function public.pitacco_save_store_delivery_code_length(p_store uuid,p_digits integer)
returns integer
language plpgsql security definer
set search_path to ''
as $body$
begin
 if (select auth.uid()) is null or not public.is_store_manager(p_store) then
  raise exception 'Sem autorização para configurar esta loja' using errcode='42501';
 end if;
 if p_digits is null or p_digits not between 4 and 8 then
  raise exception 'Escolha entre 4 e 8 dígitos' using errcode='22023';
 end if;
 insert into public.pitacco_store_delivery_code_settings(store_id,digits,updated_at,updated_by)
 values(p_store,p_digits,pg_catalog.now(),(select auth.uid()))
 on conflict(store_id) do update set digits=excluded.digits,
  updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,(select auth.uid()),'store_delivery_code_digits_changed',
  pg_catalog.jsonb_build_object('digits',p_digits,'applies_to','future_own_deliveries'));
 return p_digits;
end $body$;

-- Existing deliveries already have their own code, so pin length comes from
-- the actual code row, not the latest manager setting.
create or replace function public.pitacco_driver_own_code_lengths()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $body$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão do entregador não autorizada' using errcode='42501';
 end if;
 select coalesce(pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object('delivery_id',d.id,
       'digits',pg_catalog.length(pin.code))
   order by d.created_at desc),'[]'::jsonb) into result
 from public.deliveries d
 join public.couriers c on c.id=d.courier_id and c.active
  and c.user_id=(select auth.uid())
  and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))
 join public.pitacco_own_delivery_codes pin
  on pin.delivery_id=d.id and pin.store_id=d.store_id
 where d.source='proprio' and d.logistics_provider='loja'
   and d.status in ('atribuida','aceita','retirada');
 return result;
end $body$;

-- Issue strong random numeric code, using the store's configured length.
-- Do not expose a shared PIN or return it to the courier.
create or replace function pitacco_private.issue_own_delivery_code()
returns trigger language plpgsql security definer set search_path to ''
as $body$
declare n bigint; digits int;
begin
 if new.source='proprio' and new.logistics_provider='loja'
  and exists(select 1 from public.orders o
    where o.id=new.order_id and o.store_id=new.store_id and o.source='proprio') then
  digits:=coalesce((select s.digits::int from public.pitacco_store_delivery_code_settings s
    where s.store_id=new.store_id),6);
  n:=('x'||pg_catalog.substring(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','') from 1 for 8))::bit(32)::bigint
    % pg_catalog.power(10,digits)::bigint;
  insert into public.pitacco_own_delivery_codes(delivery_id,store_id,code)
   values(new.id,new.store_id,pg_catalog.lpad(n::text,digits,'0'))
   on conflict(delivery_id) do nothing;
 end if;
 return new;
end $body$;

-- Verify against the original code's actual size, preserving the five-attempt
-- lockout, courier authorization, arrival gate, and server-side completion.
create or replace function public.pitacco_driver_verify_own_code(p_delivery uuid,p_code text)
returns jsonb
language plpgsql security definer
set search_path to ''
as $body$
declare d public.deliveries%rowtype; code_row public.pitacco_own_delivery_codes%rowtype;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão não autorizada' using errcode='42501';
 end if;
 select src.* into d from public.deliveries src
 join public.couriers c on c.id=src.courier_id
  and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))
 where src.id=p_delivery and c.user_id=(select auth.uid()) and c.active
   and src.source='proprio' and src.logistics_provider='loja'
 for update of src;
 if not found or d.status<>'retirada' or d.arrived_at is null then
  raise exception 'Registre primeiro a chegada ao cliente' using errcode='42501';
 end if;
 select * into code_row from public.pitacco_own_delivery_codes
  where delivery_id=d.id and store_id=d.store_id for update;
 if not found then raise exception 'Código ainda não gerado' using errcode='22023';end if;
 if p_code is null or p_code !~ '^[0-9]+$'
   or pg_catalog.length(p_code)<>pg_catalog.length(code_row.code) then
  raise exception 'Código com quantidade de dígitos inválida' using errcode='22023';
 end if;
 if code_row.attempts>=5 then
  raise exception 'Tentativas esgotadas; solicite ajuda à loja' using errcode='22023';
 end if;
 if code_row.code<>p_code then
  update public.pitacco_own_delivery_codes
   set attempts=attempts+1 where delivery_id=d.id;
  return pg_catalog.jsonb_build_object('verified',false,'remaining',4-code_row.attempts);
 end if;
 update public.deliveries
   set delivery_code_verified_at=pg_catalog.now(),
    status='entregue',updated_at=pg_catalog.now()
  where id=d.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(d.store_id,d.order_id,(select auth.uid()),'courier_delivery_verified',
  pg_catalog.jsonb_build_object('delivery',d.id,'mode','pitacco_customer_code','digits',pg_catalog.length(code_row.code)));
 return pg_catalog.jsonb_build_object('verified',true,'delivered',true);
end $body$;

revoke all on function public.pitacco_store_delivery_code_length(uuid) from public,anon;
revoke all on function public.pitacco_save_store_delivery_code_length(uuid,integer) from public,anon;
revoke all on function public.pitacco_driver_own_code_lengths() from public,anon;
revoke all on function public.pitacco_driver_verify_own_code(uuid,text) from public,anon;
grant execute on function public.pitacco_store_delivery_code_length(uuid) to authenticated;
grant execute on function public.pitacco_save_store_delivery_code_length(uuid,integer) to authenticated;
grant execute on function public.pitacco_driver_own_code_lengths() to authenticated;
grant execute on function public.pitacco_driver_verify_own_code(uuid,text) to authenticated;
