-- Capability negotiation for silent administrative notifications.
-- Existing installed Android 2.0.13 apps cannot process admin_message FCM;
-- never mark messages sent to a device that would silently discard them.
alter table pitacco_private.courier_push_device
 add column if not exists supports_admin boolean not null default false;

create or replace function public.pitacco_register_courier_push_native_admin(p_token text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_courier uuid;
begin
 perform public.pitacco_register_courier_push_native(p_token);
 select c.id into strict v_courier from public.couriers c
  where c.user_id=(select auth.uid()) and c.active;
 update pitacco_private.courier_push_device
 set supports_admin=true
 where courier_id=v_courier and token=p_token
   and session_id::text=(select auth.jwt()->>'session_id')
   and push_protocol='data_only' and expires_at>now();
 if not found then raise exception 'Aparelho não autorizado' using errcode='42501'; end if;
end $$;
revoke all on function public.pitacco_register_courier_push_native_admin(text) from public,anon;
grant execute on function public.pitacco_register_courier_push_native_admin(text) to authenticated;

-- Change only the three server-controlled admin campaign functions;
-- leave ordinary order delivery FCM capabilities untouched.
do $$
declare name text;source text;changed text;
begin
 foreach name in array array[
  'public.pitacco_admin_courier_audience()',
  'public.pitacco_admin_send_courier_campaign(uuid,text,uuid,uuid,text,text)',
  'public.pitacco_claim_admin_courier_push()'
 ] loop
  select pg_get_functiondef(name::regprocedure) into source;
  if position('d.push_protocol = ''data_only''' in source)>0 then
   changed:=replace(source,'d.push_protocol = ''data_only''',
    'd.push_protocol = ''data_only'' and d.supports_admin=true');
  elsif position('d.push_protocol=''data_only''' in source)>0 then
   changed:=replace(source,'d.push_protocol=''data_only''',
    'd.push_protocol=''data_only'' and d.supports_admin=true');
  else
   raise exception 'Expected FCM capability rule missing in %',name;
  end if;
  execute changed;
 end loop;
end $$;