-- Versioned protocol for modern Android native sound; preserves legacy APKs.
-- Native devices get FCM high-priority DATA so FirebaseMessagingService runs
-- in the background to play the delivery chime + optional recorded voice.
-- Existing WebView APKs keep their notification+data background behavior.
alter table pitacco_private.courier_push_device
 add column if not exists push_protocol text not null default 'notification'
 check(push_protocol in ('notification','data_only'));
revoke all on pitacco_private.courier_push_device from public,anon,authenticated;

create or replace function public.pitacco_register_courier_push(p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare v_courier uuid; v_session uuid;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão de entregador inválida' using errcode='42501';
 end if;
 if p_token is null or length(p_token) not between 32 and 4096 or p_token !~ '^[A-Za-z0-9:_-]+$' then
  raise exception 'Dispositivo inválido' using errcode='22023';
 end if;
 select id into strict v_courier from public.couriers where user_id=(select auth.uid()) and active;
 v_session := (select auth.jwt()->>'session_id')::uuid;
 delete from pitacco_private.courier_push_device where token=p_token and courier_id<>v_courier;
 insert into pitacco_private.courier_push_device
  (courier_id,session_id,token,expires_at,push_protocol)
 values(v_courier,v_session,p_token,now()+interval '30 days','notification')
 on conflict(courier_id) do update set token=excluded.token,session_id=excluded.session_id,
  expires_at=excluded.expires_at,push_protocol='notification';
end $$;

create or replace function public.pitacco_register_courier_push_native(p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare v_courier uuid;
begin
 perform public.pitacco_register_courier_push(p_token);
 select id into strict v_courier from public.couriers
 where user_id=(select auth.uid()) and active;
 update pitacco_private.courier_push_device
 set push_protocol='data_only'
 where courier_id=v_courier and token=p_token
   and session_id::text=(select auth.jwt()->>'session_id');
end $$;

create or replace function public.pitacco_courier_push_protocol(p_token text)
returns text language sql stable security definer set search_path='' as $$
 select coalesce((
   select d.push_protocol from pitacco_private.courier_push_device d
   where d.token=p_token and d.expires_at>now()
 ),'notification')::text
$$;

revoke all on function public.pitacco_register_courier_push_native(text) from public,anon,authenticated;
grant execute on function public.pitacco_register_courier_push_native(text) to authenticated;
revoke all on function public.pitacco_courier_push_protocol(text) from public,anon,authenticated;
grant execute on function public.pitacco_courier_push_protocol(text) to service_role;
