-- CI only. Reuse the original audited, idempotent reprint routine.
create function core_auth.own_reprint_fixture(s uuid,o uuid,r uuid,reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_order public.orders%rowtype;
begin
 if not core_auth.can_act(s) then return false;end if;
 select x.* into current_order from public.orders x where x.id=o and x.store_id=s and x.source='proprio' for update;
 if not found then return false;end if;
 if current_order.status<>'accepted' or r is null or r='00000000-0000-0000-0000-000000000000' or length(trim(coalesce(reason,''))) not between 5 and 240 then
  raise exception 'Reimpressão indisponível' using errcode='22023';
 end if;
 perform public.reprint_order(o,r,reason);
 return true;
end $$;
revoke all on function core_auth.own_reprint_fixture(uuid,uuid,uuid,text) from public,anon,authenticated;
create role pitacco_core_own_print login password 'ci-own-print-only' nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema core_auth to pitacco_core_own_print;
grant execute on function core_auth.can_act(uuid),core_auth.own_reprint_fixture(uuid,uuid,uuid,text) to pitacco_core_own_print;
