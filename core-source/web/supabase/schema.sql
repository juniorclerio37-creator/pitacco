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
