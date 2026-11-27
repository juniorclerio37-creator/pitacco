-- Pitacco Entregador — credenciais temporárias e isolamento por sessão.
-- A tabela não é legível pela API para lojistas ou entregadores.
create table if not exists public.pitacco_courier_auth_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  must_change_password boolean not null default true,
  credentials_issued_at timestamptz not null default now(),
  password_changed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pitacco_courier_auth_state_store_idx
  on public.pitacco_courier_auth_state(store_id);
alter table public.pitacco_courier_auth_state enable row level security;
revoke all on table public.pitacco_courier_auth_state from public, anon, authenticated;
grant select, insert, update, delete on table public.pitacco_courier_auth_state to service_role;

create or replace function public.pitacco_courier_session_ready()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.pitacco_courier_auth_state state
      join public.couriers c on c.user_id = state.user_id and c.store_id = state.store_id
      join public.profiles p on p.id = c.user_id
      join auth.sessions session on session.user_id = c.user_id
     where state.user_id = (select auth.uid())
       and c.active = true
       and p.role = 'entregador'
       and state.must_change_password = false
       and session.id::text = (select auth.jwt()->>'session_id')
       and session.created_at >= state.credentials_issued_at
  );
$$;
revoke all on function public.pitacco_courier_session_ready() from public, anon;
grant execute on function public.pitacco_courier_session_ready() to authenticated;

drop policy if exists delivery_select on public.deliveries;
create policy delivery_select on public.deliveries for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.store_members sm
    where sm.store_id = deliveries.store_id
      and sm.user_id = (select auth.uid())
      and sm.role in ('gestor', 'lojista')
  )
  or (
    (select public.pitacco_courier_session_ready())
    and exists (
      select 1 from public.couriers c
      where c.id = deliveries.courier_id
        and c.store_id = deliveries.store_id
        and c.user_id = (select auth.uid())
        and c.active = true
    )
  )
);
