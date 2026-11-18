-- Pitacco Intelligence v4 — owner-only, non-mutating recovery preflight.
-- This does not enable courier push, schedule cron, resend FCM, alter print jobs,
-- request physical printing or mark any delivery as completed.
create function public.pitacco_owner_recovery_preflight(p_store uuid default null)
returns jsonb
language plpgsql stable security definer set search_path=''
as $preflight$
declare
 v_server_enabled boolean;
 v_device_count integer;
 v_native_devices integer;
 v_protocol_ready boolean;
 v_cron_active boolean;
 v_cron_present boolean :=false;
 v_vault_secret_present boolean;
 v_windows_registered integer;
 v_windows_recent integer;
 v_bound_windows integer;
 v_print_errors integer;
 v_print_waiting integer;
 v_last_print_outcome text;
 v_last_print_at timestamptz;
begin
 if (select auth.uid()) is null or not public.pitacco_is_platform_owner() then
  raise exception 'Diagnóstico exclusivo do Super Admin' using errcode='42501';
 end if;
 if p_store is not null and not exists(select 1 from public.stores s where s.id=p_store) then
  raise exception 'Estabelecimento não encontrado';
 end if;

 select enabled into v_server_enabled
 from pitacco_private.courier_push_settings where singleton=true;
 select count(*)::integer,
        count(*) filter(where d.push_protocol='data_only')::integer
 into v_device_count,v_native_devices
 from pitacco_private.courier_push_device d
 join public.couriers c on c.id=d.courier_id
 where d.expires_at>now() and c.active
   and (p_store is null or c.store_id=p_store);
 v_protocol_ready:=(to_regprocedure('public.pitacco_register_courier_push_native(text)') is not null)
   and (to_regprocedure('public.pitacco_courier_push_protocol(text)') is not null);

 -- Only return presence/active booleans; never read back or return cron commands
 -- or decrypted secret values. Missing extensions yield unknown, not success.
 if to_regclass('cron.job') is not null then
  v_cron_present:=true;
  begin
   execute 'select coalesce(bool_or(j.active),false) from cron.job j where j.jobname=$1'
    into v_cron_active using 'pitacco-courier-push';
  exception when insufficient_privilege or undefined_table or undefined_column then
   v_cron_active:=null;
  end;
 end if;
 if to_regclass('vault.decrypted_secrets') is not null then
  begin
   execute 'select exists(select 1 from vault.decrypted_secrets where name=$1)'
     into v_vault_secret_present using 'pitacco_push_cron_secret';
  exception when insufficient_privilege or undefined_table or undefined_column then
   v_vault_secret_present:=null;
  end;
 end if;

 select count(*)::integer,
        count(*) filter(where last_seen_at>now()-interval '90 seconds')::integer
 into v_windows_registered,v_windows_recent
 from public.pitacco_windows_presence w
 where (p_store is null or w.store_id=p_store);
 select count(*)::integer into v_bound_windows
 from public.print_devices d where (p_store is null or d.store_id=p_store);
 select count(*) filter(where j.state='error')::integer,
        count(*) filter(where j.state in ('pending','claimed')
          and j.created_at<now()-interval '10 minutes')::integer
 into v_print_errors,v_print_waiting
 from public.print_jobs j where j.created_at>=now()-interval '24 hours'
   and (p_store is null or j.store_id=p_store);
 select t.outcome,t.submitted_at into v_last_print_outcome,v_last_print_at
 from public.pitacco_windows_print_checks t
 where (p_store is null or t.store_id=p_store)
 order by t.submitted_at desc limit 1;

 return jsonb_build_object(
  'observed_at',now(),
  'scope',case when p_store is null then 'all_stores' else 'selected_store' end,
  'courier_push',jsonb_build_object(
   'server_enabled',v_server_enabled,
   'registered_devices',v_device_count,
   'native_devices',v_native_devices,
   'native_protocol_ready',v_protocol_ready,
   'cron_table_present',v_cron_present,
   'cron_active',v_cron_active,
   'cron_secret_present',v_vault_secret_present,
   'external_fcm_credentials_verified',false,
   'delivery_sound_verified',false
  ),
  'windows',jsonb_build_object(
   'registered_computers',v_windows_registered,
   'recently_connected_computers',v_windows_recent,
   'bound_print_computers',v_bound_windows,
   'print_error_jobs_24h',v_print_errors,
   'waiting_over_10m_24h',v_print_waiting,
   'latest_operator_test',case when v_last_print_outcome is null then null
    else jsonb_build_object('outcome',v_last_print_outcome,'submitted_at',v_last_print_at) end,
   'physical_print_verified_now',false,
   'automatic_order_print_verified',false
  ),
  'limits','Consulta de eventos do servidor e sinais de presença; nenhuma alteração executada. Cron ativo e dispositivo registrado não comprovam FCM funcional. Envio ao spooler não comprova papel impresso.'
 );
end
$preflight$;

revoke all on function public.pitacco_owner_recovery_preflight(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_recovery_preflight(uuid) to authenticated;
comment on function public.pitacco_owner_recovery_preflight(uuid)
 is 'Read-only owner recovery preflight: no device IDs, tokens, cron commands, decrypted secrets, customer data or physical-print/audio claims.';
