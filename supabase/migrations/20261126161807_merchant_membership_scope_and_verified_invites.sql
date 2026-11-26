-- Merchant workspace lists explicit memberships, not global platform-owner authority.
create table if not exists pitacco_private.store_member_invites(
 store_id uuid not null references public.stores(id) on delete cascade,
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 320),
 created_at timestamptz not null default now(),
 claimed_at timestamptz,
 claimed_by uuid references public.profiles(id) on delete set null,
 primary key(store_id,email)
);
alter table pitacco_private.store_member_invites enable row level security;
revoke all on pitacco_private.store_member_invites from public,anon,authenticated;
create or replace function public.pitacco_my_merchant_stores()
returns setof public.stores
language plpgsql security definer set search_path='' as $fn$
declare v_user uuid:=auth.uid();v_email text;v_invite record;
begin
 if v_user is null then raise exception 'Sessão necessária' using errcode='42501';end if;
 select lower(btrim(u.email)) into v_email from auth.users u
 where u.id=v_user and u.email_confirmed_at is not null;
 if v_email is not null and exists(select 1 from public.profiles p where p.id=v_user) then
  for v_invite in select i.store_id from pitacco_private.store_member_invites i
   where i.email=v_email and i.claimed_at is null for update
  loop
   insert into public.store_members(store_id,user_id,role) values(v_invite.store_id,v_user,'gestor')
   on conflict(store_id,user_id) do update set role='gestor';
   update pitacco_private.store_member_invites set claimed_at=clock_timestamp(),claimed_by=v_user
   where store_id=v_invite.store_id and email=v_email and claimed_at is null;
  end loop;
 end if;
 return query select s.* from public.stores s join public.store_members m on m.store_id=s.id
 where m.user_id=v_user order by s.created_at desc,s.id;
end $fn$;
revoke all on function public.pitacco_my_merchant_stores() from public,anon,authenticated;
grant execute on function public.pitacco_my_merchant_stores() to authenticated,service_role;
