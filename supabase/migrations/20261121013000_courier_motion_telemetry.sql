-- Motion detection is advisory, shift-scoped and separate from coordinates.
-- Existing 4-argument GPS RPC and old APK versions remain functional.
alter table public.courier_positions
 add column if not exists motion_state text not null default 'unknown',
 add column if not exists motion_confidence integer,
 add column if not exists motion_observed_at timestamptz;

alter table public.courier_positions
 add constraint courier_positions_motion_state_valid
 check(motion_state in ('unknown','moving','stopped') and
   (motion_confidence is null or motion_confidence between 0 and 100));

create or replace function public.pitacco_courier_background_gps_update_motion(
 p_token text,p_lat double precision,p_lng double precision,
 p_accuracy_m double precision,p_motion_state text,
 p_motion_confidence integer,p_speed_mps double precision
)
returns timestamptz
language plpgsql security definer
set search_path to ''
as $fn$
declare v_time timestamptz;
        v_courier uuid;
begin
 if p_motion_state is null or
  p_motion_state not in ('unknown','moving','stopped') or
  p_motion_confidence is null or p_motion_confidence not between 0 and 100 or
  (p_speed_mps is not null and
   (p_speed_mps<0 or p_speed_mps>80 or not isfinite(p_speed_mps))) then
  raise exception 'Estado de movimento inválido' using errcode='22023';
 end if;
 -- Reuse the established authenticated 256-bit shift token, session,
 -- banned account, courier availability and GPS quality validation.
 v_time:=public.pitacco_courier_background_gps_update(
  p_token,p_lat,p_lng,p_accuracy_m
 );
 select cap.courier_id into v_courier
 from pitacco_private.courier_gps_capabilities cap
 where cap.token_hash=extensions.digest(p_token,'sha256')
  and cap.expires_at>now();
 if v_courier is null then
  raise exception 'Plantão do GPS não autorizado' using errcode='42501';
 end if;
 update public.courier_positions pos
 set motion_state=p_motion_state,
  motion_confidence=p_motion_confidence,
  motion_observed_at=now()
 where pos.courier_id=v_courier and
  pos.observed_at>=now()-interval '90 seconds';
 return v_time;
end $fn$;
revoke all on function public.pitacco_courier_background_gps_update_motion(
 text,double precision,double precision,double precision,text,integer,double precision)
 from public,anon,authenticated;
-- The native foreground service sends only the publishable key plus the
-- short-lived token, just like the original authenticated-by-token GPS RPC.
grant execute on function public.pitacco_courier_background_gps_update_motion(
 text,double precision,double precision,double precision,text,integer,double precision)
 to anon,authenticated;

-- Merchant map reads only motion for its own explicitly authorized couriers;
-- never expose this table or another shop's fleet through public checkout.
create or replace function public.pitacco_store_courier_motion(p_store uuid)
returns table(courier_id uuid,motion_state text,motion_confidence integer,motion_observed_at timestamptz)
language plpgsql stable security definer
set search_path to ''
as $fn$
begin
 if p_store is null or not public.pitacco_can_manage_courier_store((select auth.uid()),p_store) then
  raise exception 'Sem permissão para consultar movimento dos entregadores desta loja'
   using errcode='42501';
 end if;
 return query
  select pos.courier_id,
    case when pos.motion_observed_at>now()-interval '120 seconds'
      then pos.motion_state else 'unknown' end,
    case when pos.motion_observed_at>now()-interval '120 seconds'
      then pos.motion_confidence else null end,
    pos.motion_observed_at
  from public.courier_positions pos
  join public.couriers c on c.id=pos.courier_id
  where c.active and (c.store_id=p_store or
   public.pitacco_courier_test_access(c.id,p_store));
end $fn$;
revoke all on function public.pitacco_store_courier_motion(uuid) from public,anon;
grant execute on function public.pitacco_store_courier_motion(uuid) to authenticated;
