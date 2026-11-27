-- Execute APÓS schema.sql e 003_delivery.sql.
-- Modelo: seleção automática por entregador disponível com menor número de entregas abertas.
-- Os gestores podem selecionar manualmente entregadores da frota própria ou compartilhada.
alter table public.stores add column if not exists dispatch_mode text not null default 'manual' check(dispatch_mode in ('manual','automatica'));
alter table public.couriers add column if not exists available boolean not null default false;

create table if not exists public.courier_device_tokens (
  token text primary key, courier_id uuid not null references public.couriers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android', updated_at timestamptz not null default now()
);
create index if not exists courier_tokens_courier_idx on public.courier_device_tokens(courier_id);
alter table public.courier_device_tokens enable row level security;
create policy courier_token_select on public.courier_device_tokens for select to authenticated using(user_id=(select auth.uid()));
create policy courier_token_insert on public.courier_device_tokens for insert to authenticated
 with check(user_id=(select auth.uid()) and public.is_courier(courier_id) and exists(select 1 from public.couriers c where c.id=courier_id and c.user_id=(select auth.uid())));
create policy courier_token_update on public.courier_device_tokens for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and public.is_courier(courier_id) and exists(select 1 from public.couriers c where c.id=courier_id and c.user_id=(select auth.uid())));
create policy courier_token_delete on public.courier_device_tokens for delete to authenticated using(user_id=(select auth.uid()));

create or replace function public.set_courier_availability(is_available boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.couriers set available=is_available where user_id=(select auth.uid()) and active;
 if not found then raise exception 'Entregador não encontrado ou inativo'; end if;
end$$;

-- A loja pode designar um entregador compartilhado; o administrador mantém o cadastro da frota.
create or replace function public.assign_delivery(d uuid,c uuid) returns void language plpgsql security definer set search_path='' as $$
declare s uuid; mode text; fleet text; courier_store uuid;
begin
 select store_id into s from public.deliveries where id=d and status in ('pendente','atribuida') for update;
 if s is null or not public.is_store_manager(s) then raise exception 'Entrega indisponível'; end if;
 select delivery_mode into mode from public.stores where id=s;
 select fleet_type,store_id into fleet,courier_store from public.couriers where id=c and active;
 if fleet is null or (fleet='propria' and (mode not in ('propria','ambas') or courier_store<>s))
 or (fleet='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Entregador incompatível com esta loja'; end if;
 update public.deliveries set courier_id=c,status='atribuida',updated_at=now() where id=d;
end$$;

-- Chamada interna somente via trigger; não expor RPC pública de distribuição.
create or replace function public.dispatch_delivery_on_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare chosen uuid;
begin
 if (select dispatch_mode from public.stores where id=new.store_id) <> 'automatica' then return new; end if;
 -- A seleção é serializada por loja para evitar duas entregas disputando o mesmo estado.
 perform pg_advisory_xact_lock(hashtextextended(new.store_id::text, 0));
 select c.id into chosen from public.couriers c
 where c.active and c.available and (
   (c.fleet_type='propria' and c.store_id=new.store_id and
    (select delivery_mode from public.stores where id=new.store_id) in ('propria','ambas')) or
   (c.fleet_type='compartilhada' and
    (select delivery_mode from public.stores where id=new.store_id) in ('compartilhada','ambas')))
 order by (select count(*) from public.deliveries d where d.courier_id=c.id and d.status in ('atribuida','aceita','retirada')), c.created_at, c.id
 limit 1;
 if chosen is not null then
   update public.deliveries set courier_id=chosen,status='atribuida',updated_at=now() where id=new.id;
 end if;
 return new;
end$$;
drop trigger if exists deliveries_auto_dispatch on public.deliveries;
create trigger deliveries_auto_dispatch after insert on public.deliveries for each row execute function public.dispatch_delivery_on_insert();

create or replace function public.set_store_dispatch_mode(s uuid, mode text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_store_manager(s) or mode not in ('manual','automatica') then raise exception 'Não autorizado'; end if;
 update public.stores set dispatch_mode=mode where id=s;
end$$;

revoke all on function public.set_courier_availability(boolean), public.set_store_dispatch_mode(uuid,text), public.dispatch_delivery_on_insert() from public;
grant execute on function public.set_courier_availability(boolean), public.set_store_dispatch_mode(uuid,text) to authenticated;
-- Ative a publicação Realtime para deliveries pelo painel do Supabase ou SQL:
-- alter publication supabase_realtime add table public.deliveries;
