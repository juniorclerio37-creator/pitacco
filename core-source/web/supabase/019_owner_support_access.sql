-- Pitacco owner central: read-only monitoring and consent-gated support.
-- IMPORTANT: owner identity is assigned through a protected server-side role,
-- never by a client-editable profile field. Validate against existing auth schema before applying.
begin;
create table if not exists public.platform_owners(
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.platform_owners enable row level security;
revoke all on public.platform_owners from anon,authenticated;
create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.platform_owners where user_id=(select auth.uid())) $$;
revoke all on function public.is_platform_owner() from public,anon;
grant execute on function public.is_platform_owner() to authenticated;
create table if not exists public.support_access_requests(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 requested_by uuid not null references auth.users(id),
 decided_by uuid references auth.users(id),
 reason text not null check(length(trim(reason)) between 10 and 1000),
 scope text[] not null check(cardinality(scope)>0 and scope <@ array['profile','catalog','settings','printing','integrations','delivery','subscriptions']::text[]),
 status text not null default 'pending' check(status in ('pending','approved','denied','revoked','expired')),
 requested_at timestamptz not null default now(),
 decided_at timestamptz,
 expires_at timestamptz,
 check(status<>'approved' or (decided_by is not null and expires_at is not null))
);
create index if not exists support_requests_store_status on public.support_access_requests(store_id,status,requested_at desc);
create table if not exists public.support_audit_log(
 id bigint generated always as identity primary key,
 request_id uuid not null references public.support_access_requests(id),
 store_id uuid not null references public.stores(id),
 actor_id uuid not null references auth.users(id),
 action text not null,
 entity_type text not null,
 entity_id text,
 before_data jsonb,
 after_data jsonb,
 created_at timestamptz not null default now()
);
alter table public.support_access_requests enable row level security;
alter table public.support_audit_log enable row level security;
drop policy if exists support_requests_read on public.support_access_requests;
create policy support_requests_read on public.support_access_requests for select to authenticated using(public.is_platform_owner() or public.is_store_manager(store_id));
drop policy if exists support_audit_read on public.support_audit_log;
create policy support_audit_read on public.support_audit_log for select to authenticated using(public.is_platform_owner() or public.is_store_manager(store_id));
revoke all on public.support_access_requests,public.support_audit_log from anon,authenticated;
grant select on public.support_access_requests,public.support_audit_log to authenticated;
-- Never grant direct client INSERT/UPDATE/DELETE on access requests or audit log.
-- SECURITY DEFINER RPCs must verify owner, merchant decision, expiration and scope.
-- The actual write operation must revalidate authorization within the same DB transaction.
commit;
