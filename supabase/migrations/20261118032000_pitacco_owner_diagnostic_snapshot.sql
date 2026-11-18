-- Pitacco Intelligence 2: read-only, aggregate operational signals for the platform owner.
-- Do not include order IDs, customer data, print receipts, GPS, push tokens or raw error messages.
-- Numbers indicate server-side observations, not physical print/delivery/push confirmation.
create or replace function public.pitacco_owner_diagnostic_snapshot(p_store uuid default null)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not public.pitacco_is_platform_owner() then
    raise exception 'Diagnóstico exclusivo do Super Admin' using errcode='42501';
  end if;
  if p_store is not null and not exists (select 1 from public.stores s where s.id=p_store) then
    raise exception 'Estabelecimento indisponível';
  end if;

  select jsonb_build_object(
    'observed_at',now(),
    'scope',case when p_store is null then 'all_stores' else 'selected_store' end,
    'printing',(select jsonb_build_object(
      'jobs_24h',count(*)::integer,
      'pending',count(*) filter(where state='pending')::integer,
      'claimed',count(*) filter(where state='claimed')::integer,
      'saved',count(*) filter(where state='saved')::integer,
      'submitted',count(*) filter(where state='submitted')::integer,
      'uncertain',count(*) filter(where state='uncertain')::integer,
      'error',count(*) filter(where state='error')::integer,
      'waiting_over_10m',count(*) filter(where state in ('pending','claimed')
        and created_at<now()-interval '10 minutes')::integer
      ) from public.print_jobs j
      where j.created_at>=now()-interval '24 hours'
        and (p_store is null or j.store_id=p_store)),
    'printing_checks',(select jsonb_build_object(
      'tests_7d',count(*)::integer,
      'awaiting_confirmation',count(*) filter(where outcome='awaiting_confirmation')::integer,
      'printed_confirmed',count(*) filter(where outcome='printed')::integer,
      'failed',count(*) filter(where outcome='failed')::integer,
      'uncertain',count(*) filter(where outcome='uncertain')::integer
      ) from public.pitacco_windows_print_checks t
      where t.submitted_at>=now()-interval '7 days'
        and (p_store is null or t.store_id=p_store)),
    'courier_notifications',(select jsonb_build_object(
      'server_enabled',coalesce((
        select setting.enabled from pitacco_private.courier_push_settings setting
        where setting.singleton=true
      ),false),
      'outbox_24h',count(*)::integer,
      'sent_24h',count(*) filter(where q.sent_at is not null)::integer,
      'unsent_24h',count(*) filter(where q.sent_at is null and q.expires_at>now())::integer,
      'expired_unsent_24h',count(*) filter(where q.sent_at is null and q.expires_at<=now())::integer,
      'retrying_unsent_24h',count(*) filter(where q.sent_at is null and q.attempts>0)::integer
      ) from pitacco_private.courier_push_outbox q
      join public.deliveries d on d.id=q.delivery_id
      where q.available_at>=now()-interval '24 hours'
        and (p_store is null or d.store_id=p_store)),
    'courier_devices',(select jsonb_build_object(
      'registered_active_sessions',count(*) filter(where d.expires_at>now() and c.active)::integer
      ) from pitacco_private.courier_push_device d
      join public.couriers c on c.id=d.courier_id
      where p_store is null or c.store_id=p_store),
    'ifood',(select jsonb_build_object(
      'events_24h',count(*)::integer,
      'processed_24h',count(*) filter(where e.done_at is not null)::integer,
      'unprocessed_24h',count(*) filter(where e.done_at is null)::integer,
      'late_over_10m',count(*) filter(where e.done_at is null and e.run_at<now()-interval '10 minutes')::integer,
      'retrying_unprocessed_24h',count(*) filter(where e.done_at is null and e.attempts>0)::integer
      ) from pitacco_private.ifood_events e
      join pitacco_private.ifood_merchants m on m.merchant_id=e.merchant_id
      where e.event_at>=now()-interval '24 hours'
        and (p_store is null or m.store_id=p_store)),
    'marketplace_acceptance',(select jsonb_build_object(
      'ifood_requests_24h',count(*) filter(where a.source='ifood')::integer,
      'ifood_rejected_24h',count(*) filter(where a.source='ifood' and a.state='rejected')::integer,
      '99food_requests_24h',count(*) filter(where a.source='99food')::integer,
      '99food_rejected_24h',count(*) filter(where a.source='99food' and a.state='rejected')::integer,
      'keeta_requests_24h',count(*) filter(where a.source='keeta')::integer,
      'keeta_rejected_24h',count(*) filter(where a.source='keeta' and a.state='rejected')::integer
      ) from public.marketplace_acceptance_requests a
      where a.created_at>=now()-interval '24 hours'
        and (p_store is null or a.store_id=p_store))
  ) into result;
  return result;
end;
$$;

revoke all on function public.pitacco_owner_diagnostic_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_diagnostic_snapshot(uuid) to authenticated;
comment on function public.pitacco_owner_diagnostic_snapshot(uuid)
  is 'Super Admin only: aggregate, read-only 24-hour printing, courier push and marketplace diagnostics. Print submitted != printed; push sent != delivered or audible.';
