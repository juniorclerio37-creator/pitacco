-- The standalone Admin requires this endpoint so a pre-migration backend
-- cannot authorize users through the former profiles.role rule.
create function public.pitacco_is_platform_owner()
returns boolean language sql stable security definer set search_path='' as $function$
  select exists (
    select 1 from pitacco_private.platform_owner as owner
    where owner.user_id=(select auth.uid())
  )
$function$;
revoke all on function public.pitacco_is_platform_owner() from public,anon;
grant execute on function public.pitacco_is_platform_owner() to authenticated;
