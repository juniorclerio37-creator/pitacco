-- Pitacco courier native background GPS (Android v2.0.10).
-- The browser mints an ephemeral, courier-scoped capability while online.
-- The Android foreground service holds it in MEMORY (no refresh-token race
-- with the Supabase JavaScript browser session), posting GPS via HTTPS RPC.
create table if not exists pitacco_private.courier_gps_capabilities (
 courier_id uuid primary key references public.couriers(id) on delete cascade,
 session_id uuid not null,
 token_hash bytea not null unique,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
revoke all on pitacco_private.courier_gps_capabilities from public,anon,authenticated;

create or replace function public.pitacco_courier_background_gps_start()
returns text language plpgsql security definer set search_path='' as $body$
declare v_courier uuid; v_session uuid; v_token text;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador inválida' using errcode='42501';
 end if;
 select c.id into v_courier from public.couriers c
 where c.user_id=(select auth.uid()) and c.active and c.available
 order by c.created_at desc limit 1;
 if v_courier is null then
   raise exception 'Ative o plantão antes de iniciar o GPS' using errcode='42501';
 end if;
 v_session:=(select auth.jwt()->>'session_id')::uuid;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into pitacco_private.courier_gps_capabilities(courier_id,session_id,token_hash,expires_at)
 values(v_courier,v_session,extensions.digest(v_token,'sha256'),now()+interval '12 hours')
 on conflict(courier_id) do update set session_id=excluded.session_id,
   token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now();
 return v_token;
end $body$;
revoke all on function public.pitacco_courier_background_gps_start() from public,anon,authenticated;
grant execute on function public.pitacco_courier_background_gps_start() to authenticated;

create or replace function public.pitacco_courier_background_gps_revoke()
returns void language plpgsql security definer set search_path='' as $body$
begin
 delete from pitacco_private.courier_gps_capabilities cap using public.couriers c
 where cap.courier_id=c.id and c.user_id=(select auth.uid())
   and cap.session_id::text=(select auth.jwt()->>'session_id');
end $body$;
revoke all on function public.pitacco_courier_background_gps_revoke() from public,anon,authenticated;
grant execute on function public.pitacco_courier_background_gps_revoke() to authenticated;

-- This is a narrowly scoped, high-entropy capability; anonymous callers
-- without the 256-bit token cannot identify a courier or update any GPS.
-- Revoked automatically on offline/disabled, session revoked, expiry.
create or replace function public.pitacco_courier_background_gps_update(
 p_token text,p_lat double precision,p_lng double precision,p_accuracy_m double precision)
returns timestamptz language plpgsql security definer set search_path='' as $body$
declare v_courier uuid;v_time timestamptz:=now();v_previous timestamptz;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or
    p_lat is null or p_lng is null or p_lat not between -90 and 90 or
    p_lng not between -180 and 180 or (p_lat=0 and p_lng=0) or
    p_accuracy_m is null or p_accuracy_m not between 0 and 100 then
  raise exception 'Requisição de GPS inválida' using errcode='22023';
 end if;
 select c.id into v_courier
 from pitacco_private.courier_gps_capabilities cap
 join public.couriers c on c.id=cap.courier_id and c.active and c.available
 join public.pitacco_courier_auth_state state on state.user_id=c.user_id
   and state.store_id=c.store_id and not state.must_change_password
 join auth.sessions sess on sess.id=cap.session_id and sess.user_id=c.user_id
   and sess.created_at>=state.credentials_issued_at
 join auth.users u on u.id=c.user_id and (u.banned_until is null or u.banned_until<=now())
 where cap.token_hash=extensions.digest(p_token,'sha256')
   and cap.expires_at>v_time;
 if v_courier is null then
   raise exception 'Autorização do GPS inválida ou plantão encerrado' using errcode='42501';
 end if;
 select observed_at into v_previous from public.courier_positions
 where courier_id=v_courier for update;
 if v_previous is not null and v_previous>v_time-interval '7 seconds' then return v_previous;end if;
 insert into public.courier_positions(courier_id,latitude,longitude,accuracy_m,observed_at)
 values(v_courier,p_lat,p_lng,p_accuracy_m,v_time)
 on conflict(courier_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
  accuracy_m=excluded.accuracy_m,observed_at=excluded.observed_at
 where public.courier_positions.observed_at<=v_time-interval '7 seconds';
 return v_time;
end $body$;
revoke all on function public.pitacco_courier_background_gps_update(text,double precision,double precision,double precision)
 from public,anon,authenticated;
grant execute on function public.pitacco_courier_background_gps_update(text,double precision,double precision,double precision)
 to anon,authenticated;

create or replace function pitacco_private.revoke_offline_courier_background_gps()
returns trigger language plpgsql security definer set search_path='' as $body$
begin
 if not new.active or not new.available then
   delete from pitacco_private.courier_gps_capabilities where courier_id=new.id;
 end if;
 return new;
end $body$;
drop trigger if exists pitacco_revoke_offline_background_gps on public.couriers;
create trigger pitacco_revoke_offline_background_gps
after update of active,available on public.couriers
for each row when (new.active=false or new.available=false)
execute function pitacco_private.revoke_offline_courier_background_gps();

notify pgrst,'reload schema';
