-- Read-only, per-session push readiness visible to the signed-in courier.
-- No Firebase token, push secret, device identifiers or customer details are exposed.
create or replace function public.pitacco_courier_push_readiness()
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  v_user uuid := (select auth.uid());
  v_session text := (select auth.jwt()->>'session_id');
  v_registered boolean := false;
  v_enabled boolean := false;
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
  select coalesce((select s.enabled from pitacco_private.courier_push_settings s
    where s.singleton=true),false) into v_enabled;
  return jsonb_build_object('device_registered',v_registered,
    'server_enabled',v_enabled);
end $$;
revoke all on function public.pitacco_courier_push_readiness() from public,anon,authenticated;
grant execute on function public.pitacco_courier_push_readiness() to authenticated;
