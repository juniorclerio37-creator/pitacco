alter table pitacco_private.platform_owner
  add column login_name_hash bytea check (octet_length(login_name_hash)=32);

create function public.pitacco_lookup_platform_owner_login(p_username_hash text)
returns text language sql stable security definer set search_path='' as $function$
  select account.email
  from pitacco_private.platform_owner owner
  join auth.users account on account.id=owner.user_id
  where owner.login_name_hash=case when p_username_hash ~ '^[0-9a-f]{64}$'
    then decode(p_username_hash,'hex') end
    and account.email_confirmed_at is not null
    and (account.banned_until is null or account.banned_until<=now())
$function$;
revoke all on function public.pitacco_lookup_platform_owner_login(text) from public,anon,authenticated;
grant execute on function public.pitacco_lookup_platform_owner_login(text) to service_role;
