-- Courier-facing, non-secret push readiness. No private values or tokens leak.
-- The Edge preflight separately verifies the actual Google OAuth credentials.
create or replace function public.pitacco_courier_push_readiness()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $function$
declare
 v_user uuid := (select auth.uid());
 v_session text := (select auth.jwt()->>'session_id');
 v_registered boolean := false;
 v_enabled boolean := false;
 v_cron_active boolean := false;
 v_cron_credential_present boolean := false;
begin
 if v_user is null or not public.pitacco_courier_session_ready()
    or v_session is null then
  raise exception 'Sessão de entregador não autorizada' using errcode='42501';
 end if;
 select exists(
   select 1 from pitacco_private.courier_push_device d
   join public.couriers c on c.id=d.courier_id
   where c.user_id=v_user and c.active and d.session_id::text=v_session
     and d.expires_at>now()
 ) into v_registered;
 select coalesce((select s.enabled
   from pitacco_private.courier_push_settings s
   where s.singleton=true),false) into v_enabled;
 select coalesce((select j.active from cron.job j
   where j.jobname='pitacco-courier-push' order by j.jobid desc limit 1),false)
   into v_cron_active;
 select exists(select 1 from vault.secrets v
   where v.name='pitacco_push_cron_secret') into v_cron_credential_present;
 return pg_catalog.jsonb_build_object(
   'device_registered',v_registered,
   'server_enabled',v_enabled,
   'dispatch_scheduled',v_cron_active,
   'cron_credential_present',v_cron_credential_present
 );
end
$function$;
revoke all on function public.pitacco_courier_push_readiness()
 from public,anon;
grant execute on function public.pitacco_courier_push_readiness()
 to authenticated;