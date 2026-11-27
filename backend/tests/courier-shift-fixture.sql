-- CI ONLY: synthetic identity mapping. Never apply to production.
insert into core_auth.users(id,email,password_hash,active)
select '98000000-0000-0000-0000-000000000001','courier@example.test',password_hash,true from core_auth.users where email='alice@example.test';
insert into core_auth.memberships values('98000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000001','courier',true);
insert into auth.users(id,email,email_confirmed_at) values ('98000000-0000-0000-0000-000000000001','courier@example.test',now());
insert into public.profiles(id,email,role) values ('98000000-0000-0000-0000-000000000001','courier@example.test','entregador') on conflict(id) do update set role=excluded.role;
insert into public.couriers(id,user_id,name,fleet_type,store_id,active,available) values ('98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000001','Courier Fixture','propria','20000000-0000-4000-8000-000000000001',true,true);
insert into public.pitacco_courier_auth_state(user_id,store_id,must_change_password,credentials_issued_at) values ('98000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000001',false,now()-interval '1 minute');

-- Only the known fictional courier is mirrored. No production session issuer.
create function core_auth.courier_session_mirror_fixture() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 if new.user_id='98000000-0000-0000-0000-000000000001' then
  if tg_op='INSERT' then
   insert into auth.sessions(id,user_id) values(new.id,new.user_id);
  elsif new.revoked_at is not null then
   delete from auth.sessions where id=new.id and user_id=new.user_id;
  end if;
 end if;
 return new;
end $fn$;
revoke all on function core_auth.courier_session_mirror_fixture() from public,anon,authenticated;
create trigger courier_session_mirror_fixture after insert or update of revoked_at on core_auth.sessions for each row execute function core_auth.courier_session_mirror_fixture();

create function core_auth.courier_shift_fixture(p_action text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare s uuid:=nullif(current_setting('pitacco.core_session_id',true),'')::uuid; u uuid:=auth.uid();
begin
 if u is null or not exists(
  select 1 from core_auth.sessions ss join core_auth.users usr on usr.id=ss.user_id and usr.active
  join core_auth.memberships m on m.user_id=usr.id and m.active and m.role='courier'
  join core_auth.stores st on st.id=m.store_id and st.active
  join public.couriers c on c.user_id=usr.id and c.store_id=st.id and c.active
  join auth.sessions legacy on legacy.id=ss.id and legacy.user_id=usr.id
  where ss.id=s and ss.user_id=u and ss.revoked_at is null and ss.expires_at>now()
 ) then raise exception 'Sessão do entregador não autorizada' using errcode='42501';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',s)::text,true);
 if not public.pitacco_courier_session_ready() then raise exception 'Sessão do entregador não autorizada' using errcode='42501';end if;
 case p_action
  when 'ready' then return jsonb_build_object('ready',true);
  when 'start_gps' then return jsonb_build_object('gps_token',public.pitacco_courier_background_gps_start());
  when 'revoke_gps' then
   perform public.pitacco_courier_background_gps_revoke();
   return jsonb_build_object('revoked',true);
  else raise exception 'Ação inválida' using errcode='22023';
 end case;
end $fn$;
revoke all on function core_auth.courier_shift_fixture(text) from public,anon,authenticated;
create role pitacco_core_courier_shift login password 'ci-courier-shift-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_courier_shift;
grant execute on function core_auth.courier_shift_fixture(text) to pitacco_core_courier_shift;
