-- CI ONLY. Reuse the original manager/session predicate with a read-only role.
create role pitacco_core_realtime login password 'ci-realtime-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_realtime;
grant execute on function core_auth.can_act(uuid) to pitacco_core_realtime;
do $fixture$
begin
 if not exists(select 1 from core_auth.memberships where user_id='10000000-0000-4000-8000-000000000001' and store_id='20000000-0000-4000-8000-000000000001' and role='owner' and not active) then
  raise exception 'Expected revoked synthetic owner';
 end if;
 update core_auth.memberships set active=true where user_id='10000000-0000-4000-8000-000000000001' and store_id='20000000-0000-4000-8000-000000000001' and role='owner';
end $fixture$;
