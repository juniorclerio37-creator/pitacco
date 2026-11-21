-- Validate native GPS speed without unsupported isfinite(float8).
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
   (not (p_speed_mps between 0 and 80))) then
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