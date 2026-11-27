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
