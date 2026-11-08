-- PITACCO: instalar somente em projeto novo, sem tabelas Pitacco.
-- Execute inteiro no SQL Editor. Nao apaga tabelas existentes.
begin;

-- web/supabase/schema.sql
-- DeliveryGestor 0.2 — execute no SQL Editor de um projeto Supabase novo.
create extension if not exists pgcrypto;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null, full_name text default '', role text not null default 'lojista' check(role in ('admin','gestor','lojista')), created_at timestamptz not null default now());
create table public.stores (id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name))>0), platform text not null default 'iFood e 99Food', plan text not null default 'saas' check(plan in ('saas','gestao')), created_at timestamptz not null default now());
create table public.store_members (store_id uuid not null references public.stores(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, role text not null check(role in ('gestor','lojista')), primary key(store_id,user_id));
create table public.orders (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade, channel text not null check(channel in ('iFood','99Food','Delivery próprio')), gross numeric(12,2) not null check(gross>=0), fees numeric(12,2) not null default 0 check(fees>=0), created_at timestamptz not null default now());
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade, name text not null, price numeric(12,2) not null check(price>=0), cost numeric(12,2) not null check(cost>=0), created_at timestamptz not null default now());
create table public.expenses (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade, description text not null, amount numeric(12,2) not null check(amount>=0), created_at timestamptz not null default now());
create table public.subscriptions (store_id uuid primary key references public.stores(id) on delete cascade, monthly_amount numeric(12,2) not null default 99 check(monthly_amount>=0), status text not null default 'pendente' check(status in ('pendente','ativa','atrasada','cancelada')), due_date date, updated_at timestamptz not null default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin')$$;
create function public.can_access_store(s uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_admin() or exists(select 1 from public.store_members where store_id=s and user_id=(select auth.uid()))$$;
create function public.is_store_manager(s uuid) returns boolean language sql stable security definer set search_path='' as $$select public.is_admin() or exists(select 1 from public.store_members where store_id=s and user_id=(select auth.uid()) and role='gestor')$$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.profiles(id,email,full_name) values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'full_name','')); return new; end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.add_store_member(s uuid, member_email text, member_role text) returns void language plpgsql security definer set search_path='' as $$declare target uuid; begin if not public.is_store_manager(s) then raise exception 'Acesso negado'; end if; if member_role not in ('gestor','lojista') then raise exception 'Perfil inválido'; end if; select id into target from public.profiles where lower(email)=lower(trim(member_email)); if target is null then raise exception 'Usuário não encontrado. Solicite que ele crie uma conta primeiro.'; end if; insert into public.store_members(store_id,user_id,role) values(s,target,member_role) on conflict(store_id,user_id) do update set role=excluded.role; end$$;
revoke all on function public.add_store_member(uuid,text,text) from public; grant execute on function public.add_store_member(uuid,text,text) to authenticated;
alter table public.profiles enable row level security; alter table public.stores enable row level security; alter table public.store_members enable row level security; alter table public.orders enable row level security; alter table public.products enable row level security; alter table public.expenses enable row level security; alter table public.subscriptions enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()) or public.is_admin());
create policy store_read on public.stores for select to authenticated using(public.can_access_store(id));
create policy store_insert on public.stores for insert to authenticated with check(public.is_admin());
create policy store_update on public.stores for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy member_read on public.store_members for select to authenticated using(public.can_access_store(store_id));
create policy member_insert on public.store_members for insert to authenticated with check(public.is_admin());
create policy member_delete on public.store_members for delete to authenticated using(public.is_admin());
create policy order_read on public.orders for select to authenticated using(public.can_access_store(store_id));
create policy order_insert on public.orders for insert to authenticated with check(public.can_access_store(store_id));
create policy product_read on public.products for select to authenticated using(public.can_access_store(store_id));
create policy product_insert on public.products for insert to authenticated with check(public.can_access_store(store_id));
create policy expense_read on public.expenses for select to authenticated using(public.can_access_store(store_id));
create policy expense_insert on public.expenses for insert to authenticated with check(public.can_access_store(store_id));
create policy subscription_read on public.subscriptions for select to authenticated using(public.can_access_store(store_id));
create policy subscription_insert on public.subscriptions for insert to authenticated with check(public.is_admin());
create policy subscription_update on public.subscriptions for update to authenticated using(public.is_admin()) with check(public.is_admin());
-- Depois de criar sua conta pelo aplicativo, execute manualmente no SQL Editor:
-- update public.profiles set role='admin' where email='SEU_EMAIL_AQUI';
-- Nunca coloque a service_role key no aplicativo. Use somente a chave publicável/anon.


-- web/supabase/003_delivery.sql
-- Apply AFTER schema.sql on an existing v0.2 database.
-- Fleet: shared couriers are managed by platform admin; own couriers belong to a store.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','gestor','lojista','entregador'));
alter table public.stores add column if not exists delivery_mode text not null default 'propria' check(delivery_mode in ('propria','compartilhada','ambas'));
create table if not exists public.couriers (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id),
 name text not null, phone text, fleet_type text not null check(fleet_type in ('propria','compartilhada')),
 store_id uuid references public.stores(id), active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint fleet_scope check ((fleet_type='propria' and store_id is not null) or (fleet_type='compartilhada' and store_id is null))
);
create table if not exists public.deliveries (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 order_id uuid references public.orders(id), courier_id uuid references public.couriers(id),
 customer_name text not null, address text not null, notes text default '',
 delivery_fee numeric(12,2) not null default 0 check(delivery_fee>=0),
 courier_payment numeric(12,2) not null default 0 check(courier_payment>=0),
 status text not null default 'pendente' check(status in ('pendente','atribuida','aceita','retirada','entregue','cancelada')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists deliveries_store_idx on public.deliveries(store_id,created_at desc);
create index if not exists deliveries_courier_idx on public.deliveries(courier_id,status);
create or replace function public.is_courier(c uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.couriers where id=c and user_id=(select auth.uid()) and active)$$;
create or replace function public.can_manage_courier(c uuid,s uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.couriers where id=c and active and ((fleet_type='propria' and store_id=s and public.is_store_manager(s)) or (fleet_type='compartilhada' and public.is_admin())))$$;
alter table public.couriers enable row level security;
alter table public.deliveries enable row level security;
create policy courier_select on public.couriers for select to authenticated using(public.is_admin() or user_id=(select auth.uid()) or (fleet_type='propria' and public.is_store_manager(store_id)));
create policy delivery_select on public.deliveries for select to authenticated using(public.can_access_store(store_id) or (courier_id is not null and public.is_courier(courier_id)));
-- Write access exclusively via validated RPCs. No direct INSERT/UPDATE policies.
create or replace function public.register_courier(member_email text, courier_name text, courier_phone text, fleet text, target_store uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid; cid uuid;
begin
 if fleet not in ('propria','compartilhada') then raise exception 'Tipo inválido'; end if;
 if (fleet='compartilhada' and (not public.is_admin() or target_store is not null)) or
    (fleet='propria' and (target_store is null or not public.is_store_manager(target_store))) then raise exception 'Sem permissão'; end if;
 select id into uid from public.profiles where lower(email)=lower(trim(member_email));
 if uid is null then raise exception 'Entregador deve criar uma conta antes'; end if;
 if exists(select 1 from public.couriers where user_id=uid) then raise exception 'Usuário já cadastrado como entregador'; end if;
 insert into public.couriers(user_id,name,phone,fleet_type,store_id) values(uid,trim(courier_name),courier_phone,fleet,target_store) returning id into cid;
 update public.profiles set role='entregador' where id=uid and role='lojista' and not exists(select 1 from public.store_members where user_id=uid);
 return cid;
end$$;
create or replace function public.create_delivery(s uuid, customer text, destination text, details text, fee numeric, payment numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 if fee<0 or payment<0 then raise exception 'Valor inválido'; end if;
 insert into public.deliveries(store_id,customer_name,address,notes,delivery_fee,courier_payment)
 values(s,trim(customer),trim(destination),coalesce(details,''),fee,payment) returning id into did;
 return did;
end$$;
create or replace function public.assign_delivery(d uuid,c uuid) returns void language plpgsql security definer set search_path='' as $$
declare s uuid; mode text; fleet text;
begin
 select store_id into s from public.deliveries where id=d and status in ('pendente','atribuida') for update;
 if s is null or not public.is_store_manager(s) then raise exception 'Entrega indisponível'; end if;
 select delivery_mode into mode from public.stores where id=s;
 select fleet_type into fleet from public.couriers where id=c and active;
 if fleet is null or (fleet='propria' and mode not in ('propria','ambas')) or (fleet='compartilhada' and mode not in ('compartilhada','ambas')) or not public.can_manage_courier(c,s) then raise exception 'Entregador não autorizado para esta loja'; end if;
 update public.deliveries set courier_id=c,status='atribuida',updated_at=now() where id=d;
end$$;
create or replace function public.set_delivery_status(d uuid, next_status text) returns void language plpgsql security definer set search_path='' as $$
declare rec public.deliveries%rowtype; manager boolean; driver boolean;
begin
 select * into rec from public.deliveries where id=d for update;
 if not found then raise exception 'Entrega inexistente'; end if;
 manager:=public.is_store_manager(rec.store_id);
 driver:=rec.courier_id is not null and public.is_courier(rec.courier_id);
 if not ((manager and ((rec.status='pendente' and next_status='cancelada') or (rec.status='atribuida' and next_status='cancelada'))) or
 (driver and ((rec.status='atribuida' and next_status='aceita') or (rec.status='aceita' and next_status='retirada') or (rec.status='retirada' and next_status='entregue')))) then raise exception 'Transição não permitida'; end if;
 update public.deliveries set status=next_status,updated_at=now() where id=d;
end$$;
create or replace function public.set_store_delivery_mode(s uuid, mode text) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_store_manager(s) or mode not in ('propria','compartilhada','ambas') then raise exception 'Não autorizado'; end if;
 update public.stores set delivery_mode=mode where id=s;
end$$;
revoke all on function public.register_courier(text,text,text,text,uuid), public.create_delivery(uuid,text,text,text,numeric,numeric), public.assign_delivery(uuid,uuid), public.set_delivery_status(uuid,text), public.set_store_delivery_mode(uuid,text) from public;
grant execute on function public.register_courier(text,text,text,text,uuid), public.create_delivery(uuid,text,text,text,numeric,numeric), public.assign_delivery(uuid,uuid), public.set_delivery_status(uuid,text), public.set_store_delivery_mode(uuid,text) to authenticated;


-- android/supabase/004_dispatch_mobile.sql
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


-- android/supabase/005_routes_and_delivery_codes.sql
-- Execute após 004_dispatch_mobile.sql. Segurança de códigos por canal.
alter table public.deliveries add column if not exists source text not null default 'proprio'
  check (source in ('proprio','ifood','99food','keeta'));
alter table public.deliveries add column if not exists requires_delivery_code boolean not null default false;
alter table public.deliveries add column if not exists delivery_code_verified_at timestamptz;
-- Marketplace: nunca concluir com código exigido sem confirmação registrada por backend confiável.
create or replace function public.set_delivery_status(d uuid, next_status text) returns void
language plpgsql security definer set search_path='' as $$
declare rec public.deliveries%rowtype; manager boolean; driver boolean;
begin
 select * into rec from public.deliveries where id=d for update;
 if not found then raise exception 'Entrega inexistente'; end if;
 manager:=public.is_store_manager(rec.store_id);
 driver:=rec.courier_id is not null and public.is_courier(rec.courier_id);
 if not ((manager and ((rec.status='pendente' and next_status='cancelada') or (rec.status='atribuida' and next_status='cancelada'))) or
 (driver and ((rec.status='atribuida' and next_status='aceita') or (rec.status='aceita' and next_status='retirada') or (rec.status='retirada' and next_status='entregue')))) then
   raise exception 'Transição não permitida';
 end if;
 if next_status='entregue' and rec.requires_delivery_code and rec.delivery_code_verified_at is null then
   raise exception 'Código ainda não confirmado pela plataforma';
 end if;
 update public.deliveries set status=next_status,updated_at=now() where id=d;
end$$;
revoke all on function public.set_delivery_status(uuid,text) from public;
grant execute on function public.set_delivery_status(uuid,text) to authenticated;
-- Campos source/requires_delivery_code são definidos apenas por integração de backend confiável.
-- ATENÇÃO: criar fluxo de ingestão oficial antes de usar pedidos de marketplace.


-- web/supabase/006_dispatch_batches.sql
-- Run after schema.sql, 003_delivery.sql and (if using driver app) 004/005.
create table if not exists public.delivery_batches (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.deliveries add column if not exists batch_id uuid references public.delivery_batches(id);
create index if not exists deliveries_batch_idx on public.deliveries(batch_id);
alter table public.delivery_batches enable row level security;
create policy batches_read on public.delivery_batches for select to authenticated
 using (public.can_access_store(store_id) or public.is_courier(courier_id));
-- Atomic multi-order assignment. Shared couriers: admin only, matching existing authorization rules.
create or replace function public.assign_delivery_batch(s uuid, courier uuid, delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; expected_count integer; matching_count integer; fleet text; mode text;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 expected_count := coalesce(array_length(delivery_ids,1),0);
 if expected_count < 2 or expected_count > 15 then raise exception 'Selecione entre 2 e 15 entregas'; end if;
 if (select count(distinct x) from unnest(delivery_ids) x) <> expected_count then raise exception 'Pedidos repetidos'; end if;
 select delivery_mode into mode from public.stores where id=s;
 select fleet_type into fleet from public.couriers where id=courier and active;
 if fleet is null or not public.can_manage_courier(courier,s) or
   (fleet='propria' and mode not in ('propria','ambas')) or
   (fleet='compartilhada' and mode not in ('compartilhada','ambas')) then
   raise exception 'Entregador não autorizado';
 end if;
 -- Lock rows before checking eligibility to avoid concurrent assignments.
 perform 1 from public.deliveries where id=any(delivery_ids) for update;
 select count(*) into matching_count from public.deliveries
 where id=any(delivery_ids) and store_id=s and status in ('pendente','atribuida') and batch_id is null;
 if matching_count <> expected_count then raise exception 'Uma ou mais entregas não estão disponíveis'; end if;
 insert into public.delivery_batches(store_id,courier_id,created_by)
 values(s,courier,(select auth.uid())) returning id into batch;
 update public.deliveries set courier_id=courier,status='atribuida',batch_id=batch,updated_at=now()
 where id=any(delivery_ids);
 return batch;
end$$;
revoke all on function public.assign_delivery_batch(uuid,uuid,uuid[]) from public;
grant execute on function public.assign_delivery_batch(uuid,uuid,uuid[]) to authenticated;


-- web/supabase/007_marketplace_logistics.sql
-- Execute after 003, 004, 005 and 006. A marketplace order may be delivered
-- by the platform's own courier: it must NEVER enter the store courier queue.
-- 'source' (005) identifies where the order was placed; logistics_provider
-- identifies who performs the last-mile delivery. They are independent.
alter table public.deliveries add column if not exists logistics_provider text not null default 'loja'
  check (logistics_provider in ('loja','marketplace'));
alter table public.deliveries add column if not exists external_order_id text;
alter table public.deliveries add column if not exists external_delivery_status text;
create unique index if not exists deliveries_external_order_unique
 on public.deliveries(store_id,source,external_order_id) where external_order_id is not null;
create index if not exists deliveries_dispatch_eligible_idx
 on public.deliveries(store_id,status) where logistics_provider='loja';
-- Forbid marketplace courier assignment even if a caller invokes an older RPC.
create or replace function public.guard_marketplace_logistics() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.logistics_provider='marketplace' then
   if new.source not in ('ifood','99food','keeta') then
     raise exception 'Entrega parceira exige origem marketplace';
   end if;
   if new.courier_id is not null or new.batch_id is not null or
      new.status in ('atribuida','aceita','retirada') then
     raise exception 'Entrega parceira não pode ser atribuída a entregador próprio';
   end if;
   if tg_op='UPDATE' and old.logistics_provider='loja' and
      old.status not in ('pendente','cancelada') then
     raise exception 'Não altere o operador logístico de entrega em andamento';
   end if;
 end if;
 if tg_op='UPDATE' and old.logistics_provider='marketplace' and
    new.logistics_provider='loja' then
   raise exception 'Alteração de operador exige fluxo autorizado de migração';
 end if;
 return new;
end$$;
drop trigger if exists deliveries_marketplace_guard on public.deliveries;
create trigger deliveries_marketplace_guard before insert or update on public.deliveries
 for each row execute function public.guard_marketplace_logistics();
-- Ingestion from authenticated manager is for MANUAL TEST ENTRY only;
-- official marketplace synchronization must use a separate verified server integration.
create or replace function public.register_marketplace_partner_delivery(
 s uuid, marketplace text, external_ref text, customer text, destination text,
 details text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 if marketplace not in ('ifood','99food','keeta') then raise exception 'Origem inválida'; end if;
 if length(trim(coalesce(external_ref,'')))<1 or length(trim(coalesce(customer,'')))<1
    or length(trim(coalesce(destination,'')))<1 then raise exception 'Dados obrigatórios'; end if;
 insert into public.deliveries(store_id,source,logistics_provider,external_order_id,
  customer_name,address,notes,delivery_fee,courier_payment,status)
 values(s,marketplace,'marketplace',trim(external_ref),trim(customer),trim(destination),
  coalesce(details,''),0,0,'pendente') returning id into did;
 return did;
end$$;
revoke all on function public.register_marketplace_partner_delivery(uuid,text,text,text,text,text) from public;
grant execute on function public.register_marketplace_partner_delivery(uuid,text,text,text,text,text) to authenticated;
-- Auto-dispatch from 004 is replaced to ignore partner deliveries.
create or replace function public.dispatch_delivery_on_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare chosen uuid;
begin
 if new.logistics_provider <> 'loja' or
    (select dispatch_mode from public.stores where id=new.store_id) <> 'automatica'
 then return new; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.store_id::text,0));
 select c.id into chosen from public.couriers c where c.active and c.available and
 ((c.fleet_type='propria' and c.store_id=new.store_id and
   (select delivery_mode from public.stores where id=new.store_id) in ('propria','ambas'))
 or (c.fleet_type='compartilhada' and
   (select delivery_mode from public.stores where id=new.store_id) in ('compartilhada','ambas')))
 order by (select count(*) from public.deliveries d where d.courier_id=c.id
   and d.status in ('atribuida','aceita','retirada')),c.created_at,c.id limit 1;
 if chosen is not null then
  update public.deliveries set courier_id=chosen,status='atribuida',updated_at=now() where id=new.id;
 end if;
 return new;
end$$;
-- Explicitly block dispatch in RPCs; guard trigger is defense in depth.
create or replace function public.assign_delivery_batch(s uuid,courier uuid,delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; n integer; fleet text; mode text;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 n:=coalesce(array_length(delivery_ids,1),0);
 if n<2 or n>15 or (select count(distinct x) from unnest(delivery_ids) x)<>n
 then raise exception 'Selecione de 2 a 15 entregas distintas'; end if;
 select delivery_mode into mode from public.stores where id=s;
 select fleet_type into fleet from public.couriers where id=courier and active;
 if fleet is null or not public.can_manage_courier(courier,s) or
 (fleet='propria' and mode not in ('propria','ambas')) or
 (fleet='compartilhada' and mode not in ('compartilhada','ambas'))
 then raise exception 'Entregador não autorizado'; end if;
 perform 1 from public.deliveries where id=any(delivery_ids) for update;
 if (select count(*) from public.deliveries where id=any(delivery_ids)
   and store_id=s and logistics_provider='loja' and
   status in ('pendente','atribuida') and batch_id is null)<>n
 then raise exception 'O lote contém entrega parceira ou indisponível'; end if;
 insert into public.delivery_batches(store_id,courier_id,created_by)
 values(s,courier,(select auth.uid())) returning id into batch;
 update public.deliveries set courier_id=courier,status='atribuida',batch_id=batch,updated_at=now()
 where id=any(delivery_ids);
 return batch;
end$$;
-- Existing assign_delivery RPC is protected by guard trigger as well.
-- Partner status is intentionally read-only until official authenticated webhook
-- ingestion is implemented, with signature verification, idempotency and mapping.


-- web/supabase/008_imports_external_delivery.sql
-- Execute after 007. Import is staging-only: no publishing or API scraping.
create table if not exists public.menu_import_staging (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade,
 source_platform text not null check(source_platform in ('ifood','99food','keeta')),
 external_id text not null, name text not null, category text, description text,
 price numeric(12,2) not null check(price>=0), raw_data jsonb not null default '{}'::jsonb,
 review_status text not null default 'pendente' check(review_status in ('pendente','aprovado','rejeitado')),
 created_at timestamptz not null default now()
);
create table if not exists public.external_delivery_requests (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade,
 provider text not null check(provider in ('99entrega','uber_direct','ifood_on_demand')),
 reference text not null, customer_name text not null, destination text not null,
 status text not null default 'rascunho' check(status in ('rascunho','cotado','confirmado','em_andamento','concluido','cancelado','falhou')),
 provider_reference text, created_at timestamptz not null default now()
);
alter table public.menu_import_staging enable row level security;
alter table public.external_delivery_requests enable row level security;
create policy "menu manager read" on public.menu_import_staging for select to authenticated using(public.is_store_manager(store_id));
create policy "menu manager insert" on public.menu_import_staging for insert to authenticated with check(public.is_store_manager(store_id));
create policy "menu manager update" on public.menu_import_staging for update to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
create policy "external manager read" on public.external_delivery_requests for select to authenticated using(public.is_store_manager(store_id));
create policy "external manager draft" on public.external_delivery_requests for insert to authenticated with check(public.is_store_manager(store_id) and status='rascunho');
-- No client UPDATE policy: status transitions require a future trusted backend.
create index if not exists idx_menu_import_store on public.menu_import_staging(store_id,created_at desc);
create index if not exists idx_external_requests_store on public.external_delivery_requests(store_id,created_at desc);


-- web/supabase/009_menu_images_dispatch_policy.sql
-- Apply after 008. Multi-tenant staging images, dispatch settings and safe server-side assignments.
alter table public.menu_import_staging add column if not exists image_source text;
alter table public.menu_import_staging add column if not exists image_path text;
alter table public.stores add column if not exists dispatch_mode text not null default 'manual' check(dispatch_mode in ('manual','automatico','misto'));
alter table public.stores add column if not exists max_orders_per_trip integer not null default 1 check(max_orders_per_trip between 1 and 15);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('menu-import-images','menu-import-images',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy "menu_images_read" on storage.objects for select to authenticated using(bucket_id='menu-import-images' and exists(select 1 from public.stores s where s.id::text=split_part(name,'/',1) and public.is_store_manager(s.id)));
create policy "menu_images_insert" on storage.objects for insert to authenticated with check(bucket_id='menu-import-images' and exists(select 1 from public.stores s where s.id::text=split_part(name,'/',1) and public.is_store_manager(s.id)));
create or replace function public.set_dispatch_policy(s uuid, dispatch text, max_orders integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_store_manager(s) or dispatch not in ('manual','automatico','misto') or max_orders not between 1 and 15 then raise exception 'Configuração inválida';end if;
 update public.stores set dispatch_mode=dispatch,max_orders_per_trip=max_orders where id=s;
end$$;
-- One-order automatic assignment. Chooses least-busy authorized courier; no route optimization claimed.
create or replace function public.auto_assign_delivery(s uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid; cid uuid; fleetmode text; dispatch text;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão';end if;
 select delivery_mode,dispatch_mode into fleetmode,dispatch from public.stores where id=s;
 if dispatch not in ('automatico','misto') then raise exception 'Modo automático desabilitado';end if;
 select id into did from public.deliveries where store_id=s and status='pendente' and courier_id is null and coalesce(logistics_provider,'')<>'marketplace' order by created_at,id for update skip locked limit 1;
 if did is null then raise exception 'Nenhuma entrega pendente';end if;
 select c.id into cid from public.couriers c
 where c.active and ((c.fleet_type='propria' and c.store_id=s and fleetmode in ('propria','ambas')) or (c.fleet_type='compartilhada' and fleetmode in ('compartilhada','ambas') and public.is_admin()))
 and public.can_manage_courier(c.id,s)
 and not exists(select 1 from public.deliveries d where d.courier_id=c.id and d.status in ('atribuida','aceita','retirada'))
 order by c.created_at,c.id limit 1;
 if cid is null then raise exception 'Nenhum entregador livre autorizado';end if;
 update public.deliveries set courier_id=cid,status='atribuida',updated_at=now() where id=did;
 return did;
end$$;
-- Append only to a batch owned by same store, same courier, respecting max trip size.
create or replace function public.append_delivery_to_batch(s uuid, delivery_id uuid, p_batch_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.delivery_batches%rowtype; cap integer; current_count integer;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão';end if;
 select * into b from public.delivery_batches where id=p_batch_id and store_id=s for update;
 if not found then raise exception 'Viagem inexistente';end if;
 select max_orders_per_trip into cap from public.stores where id=s;
 perform 1 from public.deliveries where id=delivery_id and store_id=s and status='pendente' and courier_id is null and batch_id is null and coalesce(logistics_provider,'')<>'marketplace' for update;
 if not found then raise exception 'Pedido não está disponível';end if;
 select count(*) into current_count from public.deliveries where deliveries.batch_id=p_batch_id and status not in ('entregue','cancelada');
 if current_count>=cap then raise exception 'Limite de pedidos por viagem atingido';end if;
 if exists(select 1 from public.deliveries where deliveries.batch_id=p_batch_id and status in ('retirada','entregue')) then raise exception 'Viagem já iniciada';end if;
 update public.deliveries set courier_id=b.courier_id,batch_id=b.id,status='atribuida',updated_at=now() where id=delivery_id;
end$$;
-- Replace batch assignment with limit enforcement (same checks as 006).
create or replace function public.assign_delivery_batch(s uuid, courier uuid, delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; expected_count integer; matching_count integer; fleet text; mode text; cap integer;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão';end if;
 expected_count:=coalesce(array_length(delivery_ids,1),0);
 select delivery_mode,max_orders_per_trip into mode,cap from public.stores where id=s;
 if expected_count<2 or expected_count>cap then raise exception 'Quantidade excede limite da viagem';end if;
 if (select count(distinct x) from unnest(delivery_ids) x)<>expected_count then raise exception 'Pedidos repetidos';end if;
 select fleet_type into fleet from public.couriers where id=courier and active;
 if fleet is null or not public.can_manage_courier(courier,s) or (fleet='propria' and mode not in ('propria','ambas')) or (fleet='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Entregador não autorizado';end if;
 perform 1 from public.deliveries where id=any(delivery_ids) for update;
 select count(*) into matching_count from public.deliveries where id=any(delivery_ids) and store_id=s and status='pendente' and courier_id is null and batch_id is null and coalesce(logistics_provider,'')<>'marketplace';
 if matching_count<>expected_count then raise exception 'Pedidos indisponíveis';end if;
 insert into public.delivery_batches(store_id,courier_id,created_by) values(s,courier,auth.uid()) returning id into batch;
 update public.deliveries set courier_id=courier,status='atribuida',batch_id=batch,updated_at=now() where id=any(delivery_ids);
 return batch;
end$$;
revoke all on function public.set_dispatch_policy(uuid,text,integer),public.auto_assign_delivery(uuid),public.append_delivery_to_batch(uuid,uuid,uuid) from public;
grant execute on function public.set_dispatch_policy(uuid,text,integer),public.auto_assign_delivery(uuid),public.append_delivery_to_batch(uuid,uuid,uuid) to authenticated;


-- web/supabase/010_acceptance_printing.sql
-- DeliveryGestor Windows / shared web operations. Apply once after schema + 003..009.
-- Historical finance rows are deliberately not treated as incoming orders.

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


-- web/supabase/011_public_checkout.sql

alter table public.products add column menu_active boolean not null default false;
alter table public.products add column category text not null default '';
alter table public.products add column description text not null default '';
alter table public.products add column image_url text not null default '';
-- Existing finance/product forms keep their permissions; publishing is manager-only.
revoke insert on public.products from authenticated;
grant insert(store_id,name,price,cost) on public.products to authenticated;
revoke all on public.products,public.orders,public.deliveries from anon;
create table public.public_menu_settings (
 store_id uuid primary key references public.stores(id),slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
 enabled boolean not null default false,delivery_enabled boolean not null default true,pickup_enabled boolean not null default true,
 delivery_fee numeric(10,2) not null default 0 check(delivery_fee between 0 and 1000),
 payment_methods text[] not null default array['dinheiro']::text[],pix_instructions text not null default '',
 check(delivery_enabled or pickup_enabled),check(cardinality(payment_methods) between 1 and 3 and payment_methods <@ array['dinheiro','cartao_entrega','pix_manual']::text[])
);
create table public.public_checkouts (
 order_id uuid primary key references public.orders(id),store_id uuid not null references public.stores(id),request_id uuid not null,
 tracking_token uuid not null unique default gen_random_uuid(),expires_at timestamptz not null default now()+interval '7 days',
 payload jsonb not null,phone text not null,payment_instructions text not null default '',created_at timestamptz not null default now(),unique(store_id,request_id)
);
create index public_checkout_rate on public.public_checkouts(store_id,created_at,phone);
create table public.manual_payments (
 order_id uuid primary key references public.orders(id),store_id uuid not null references public.stores(id),request_id uuid not null unique,
 amount numeric(12,2) not null check(amount>0),reference text not null,confirmed_by uuid not null references auth.users(id),confirmed_at timestamptz not null default now()
);
alter table public.public_menu_settings enable row level security;
alter table public.public_checkouts enable row level security;
alter table public.manual_payments enable row level security;
revoke all on public.public_menu_settings,public.public_checkouts,public.manual_payments from public,anon,authenticated;
grant select on public.public_menu_settings,public.manual_payments to authenticated;
create policy menu_manager_read on public.public_menu_settings for select to authenticated using(public.is_store_manager(store_id));
create policy payment_manager_read on public.manual_payments for select to authenticated using(public.is_store_manager(store_id));
create function public.save_public_menu_settings(p_store uuid,p_slug text,p_enabled boolean,p_delivery_enabled boolean,p_pickup_enabled boolean,p_delivery_fee numeric,p_payment_methods text[],p_pix_instructions text default '') returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,59}$' or p_enabled is null or p_delivery_enabled is null or p_pickup_enabled is null or not(p_delivery_enabled or p_pickup_enabled) or p_delivery_fee is null or p_delivery_fee<0 or p_delivery_fee>1000 or p_payment_methods is null or cardinality(p_payment_methods) not between 1 and 3 or not p_payment_methods <@ array['dinheiro','cartao_entrega','pix_manual']::text[] or array_position(p_payment_methods,null) is not null or (select count(distinct x) from unnest(p_payment_methods)x)<>cardinality(p_payment_methods) or length(coalesce(p_pix_instructions,''))>1000 or ('pix_manual'=any(p_payment_methods) and length(trim(coalesce(p_pix_instructions,'')))<3) then raise exception 'Configuracao invalida'; end if;
 insert into public.public_menu_settings values(p_store,p_slug,p_enabled,p_delivery_enabled,p_pickup_enabled,round(p_delivery_fee,2),p_payment_methods,public.dg_clean_text(p_pix_instructions))
 on conflict(store_id) do update set slug=excluded.slug,enabled=excluded.enabled,delivery_enabled=excluded.delivery_enabled,pickup_enabled=excluded.pickup_enabled,delivery_fee=excluded.delivery_fee,payment_methods=excluded.payment_methods,pix_instructions=excluded.pix_instructions;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'menu_settings_saved',jsonb_build_object('slug',p_slug));
end $$;
create function public.save_menu_product(p_store uuid,p_product uuid,p_name text,p_price numeric,p_category text,p_description text,p_image_url text,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$ declare pid uuid; begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_price is null or p_price<0 or p_price>100000 or length(coalesce(p_category,''))>80 or length(coalesce(p_description,''))>1000 or length(coalesce(p_image_url,''))>1000 or p_active is null or (coalesce(p_image_url,'')<>'' and p_image_url !~ '^https://[^[:space:]]+$') then raise exception 'Produto invalido'; end if;
 if p_product is null then
 insert into public.products(store_id,name,price,cost,menu_active,category,description,image_url) values(p_store,trim(p_name),round(p_price,2),0,p_active,coalesce(p_category,''),coalesce(p_description,''),coalesce(p_image_url,'')) returning id into pid;
 else
 update public.products set name=trim(p_name),price=round(p_price,2),menu_active=p_active,category=coalesce(p_category,''),description=coalesce(p_description,''),image_url=coalesce(p_image_url,'') where id=p_product and store_id=p_store returning id into pid;
 if pid is null then raise exception 'Produto inexistente nesta loja'; end if;
 end if;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'menu_product_saved',jsonb_build_object('product_id',pid));return pid;
end $$;
create function public.get_public_menu(p_slug text) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare cfg public.public_menu_settings%rowtype; items jsonb; begin
 select * into cfg from public.public_menu_settings where slug=p_slug and enabled;if not found then raise exception 'Cardapio indisponivel';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'description',p.description,'image_url',p.image_url) order by p.category,p.name,p.id),'[]') into items from public.products p where p.store_id=cfg.store_id and p.menu_active;
 return jsonb_build_object('store',jsonb_build_object('name',(select name from public.stores where id=cfg.store_id),'slug',cfg.slug,'delivery_enabled',cfg.delivery_enabled,'pickup_enabled',cfg.pickup_enabled,'delivery_fee',cfg.delivery_fee,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $$;
create function public.checkout_public_order(p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,p_items jsonb,p_fulfillment text,p_payment text,p_notes text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.public_menu_settings%rowtype; prior public.public_checkouts%rowtype; item jsonb; product public.products%rowtype; canonical jsonb; normalized jsonb; snapshot jsonb:='[]'; v_phone text; customer text; address text; notes text; quantity integer; subtotal numeric:=0; fee numeric; total numeric; oid uuid; token uuid; st text;
begin
 if p_request is null or p_customer is null or length(trim(p_customer)) not between 2 and 120 or p_phone is null or length(p_phone)>30 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') or p_payment is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos';end if;
 if jsonb_array_length(p_items) not between 1 and 30 or octet_length(p_items::text)>12000 then raise exception 'Carrinho invalido';end if;
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');if length(v_phone) not between 10 and 13 then raise exception 'Telefone invalido';end if;
 customer:=public.dg_clean_text(trim(p_customer));address:=public.dg_clean_text(trim(coalesce(p_address,'')));notes:=public.dg_clean_text(trim(coalesce(p_notes,'')));
 if p_fulfillment='delivery' and length(address)<5 then raise exception 'Informe o endereco';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'object' or not item ?& array['product_id','quantity'] or (item-array['product_id','quantity'])<>'{}'::jsonb or jsonb_typeof(item->'product_id')<>'string' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity')!~ '^[0-9]+$' then raise exception 'Item invalido';end if;
 quantity:=(item->>'quantity')::integer;if quantity not between 1 and 20 then raise exception 'Quantidade invalida';end if;perform(item->>'product_id')::uuid;end loop;
 if(select count(distinct(value->>'product_id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Produto repetido';end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer) order by(value->>'product_id')::uuid) into normalized from jsonb_array_elements(p_items);
 canonical:=jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',notes);
 select * into cfg from public.public_menu_settings where slug=p_slug for update;if not found then raise exception 'Cardapio indisponivel';end if;
 select * into prior from public.public_checkouts where store_id=cfg.store_id and request_id=p_request;
 if found then
 if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
 return(select jsonb_build_object('order_id',o.id,'tracking_token',prior.tracking_token,'total',o.gross,'status',o.status,'payment_status',case when exists(select 1 from public.manual_payments where order_id=o.id) then 'paid_manual' else 'pending' end,'payment_instructions',prior.payment_instructions) from public.orders o where o.id=prior.order_id);end if;
 if not cfg.enabled or (p_fulfillment='delivery' and not cfg.delivery_enabled) or (p_fulfillment='pickup' and not cfg.pickup_enabled) or not p_payment=any(cfg.payment_methods) then raise exception 'Modalidade indisponivel';end if;
 if exists(select 1 from public.orders where store_id=cfg.store_id and request_id=p_request) then raise exception 'Chave indisponivel';end if;
 if(select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.created_at>now()-interval '1 minute')>=100 or (select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.phone=v_phone and c.created_at>now()-interval '15 minutes')>=5 then raise exception 'Limite temporario de pedidos';end if;
 for item in select value from jsonb_array_elements(normalized) loop
 select * into product from public.products where id=(item->>'product_id')::uuid and store_id=cfg.store_id and menu_active for share;if not found then raise exception 'Produto indisponivel';end if;
 quantity:=(item->>'quantity')::integer;subtotal:=subtotal+product.price*quantity;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('name',public.dg_clean_text(product.name),'quantity',quantity,'unit_price',product.price,'modifiers','[]'::jsonb));end loop;
 fee:=case when p_fulfillment='delivery' then cfg.delivery_fee else 0 end;total:=subtotal+fee;if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'total',total,'discount',0,'notes',notes,'payment',p_payment,'payment_status','pending','logistics',case when p_fulfillment='delivery' then 'loja' else 'retirada' end)) returning id into oid;
 insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,payment_instructions) values(oid,cfg.store_id,p_request,canonical,v_phone,case when p_payment='pix_manual' then cfg.pix_instructions else '' end) returning tracking_token into token;
 insert into public.operation_audit(store_id,order_id,actor,action) values(cfg.store_id,oid,auth.uid(),'public_checkout_created');
 if exists(select 1 from public.acceptance_settings where store_id=cfg.store_id and source='proprio' and mode='automatic' and enabled) then perform public.dg_accept_own(oid);end if;
 select status into st from public.orders where id=oid;
 return jsonb_build_object('order_id',oid,'tracking_token',token,'total',total,'status',st,'payment_status','pending','payment_instructions',case when p_payment='pix_manual' then cfg.pix_instructions else '' end);
end $$;
create function public.track_public_order(p_token uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('order_number',o.id,'status',o.status,'delivery_status',d.status,'total',o.gross,'payment_status',case when m.order_id is null then 'pending' else 'paid_manual' end,'created_at',o.created_at,'payment_instructions',c.payment_instructions)
 from public.public_checkouts c join public.orders o on o.id=c.order_id left join public.deliveries d on d.order_id=o.id left join public.manual_payments m on m.order_id=o.id where c.tracking_token=p_token and c.expires_at>now()
$$;
create function public.confirm_manual_payment(p_order uuid,p_request uuid,p_amount numeric,p_reference text) returns void language plpgsql security definer set search_path='' as $$ declare o public.orders%rowtype;m public.manual_payments%rowtype;begin
 select * into o from public.orders where id=p_order for update;if not found or not public.is_store_manager(o.store_id) then raise exception 'Sem permissao';end if;
 if o.source<>'proprio' or o.status not in ('pending','accepted') or coalesce(o.receipt->>'payment','') not in ('dinheiro','cartao_entrega','pix_manual','pix','cartao') or p_request is null or p_amount is null or p_amount<>o.gross or length(trim(coalesce(p_reference,''))) not between 5 and 300 then raise exception 'Confira valor integral e referencia';end if;
 select * into m from public.manual_payments where order_id=o.id;if found then
 if m.request_id=p_request and m.amount=p_amount and m.reference=public.dg_clean_text(trim(p_reference)) then return;end if;raise exception 'Pagamento ja registrado';end if;
 insert into public.manual_payments values(o.id,o.store_id,p_request,p_amount,public.dg_clean_text(trim(p_reference)),auth.uid(),now());
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(o.store_id,o.id,auth.uid(),'manual_payment_confirmed',jsonb_build_object('amount',p_amount,'reference',public.dg_clean_text(p_reference)));
end $$;
-- Carry delivery fee into the courier record without changing existing dispatch rules.
create function public.dg_copy_checkout_fee() returns trigger language plpgsql set search_path='' as $$ begin
 if new.order_id is not null then new.delivery_fee:=coalesce((select (receipt->>'delivery_fee')::numeric from public.orders where id=new.order_id),new.delivery_fee);end if;return new;end $$;
create trigger checkout_delivery_fee before insert on public.deliveries for each row execute function public.dg_copy_checkout_fee();
revoke all on function public.save_public_menu_settings(uuid,text,boolean,boolean,boolean,numeric,text[],text),public.save_menu_product(uuid,uuid,text,numeric,text,text,text,boolean),public.get_public_menu(text),public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text),public.track_public_order(uuid),public.confirm_manual_payment(uuid,uuid,numeric,text),public.dg_copy_checkout_fee() from public,anon,authenticated;
grant execute on function public.save_public_menu_settings(uuid,text,boolean,boolean,boolean,numeric,text[],text),public.save_menu_product(uuid,uuid,text,numeric,text,text,text,boolean),public.confirm_manual_payment(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.get_public_menu(text),public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text),public.track_public_order(uuid) to anon,authenticated;

commit;