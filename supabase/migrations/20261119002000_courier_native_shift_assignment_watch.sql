-- Fallback when FCM delivery is unavailable: the EXISTING GPS foreground
-- service watches ONLY this online courier's assigned delivery UUIDs.
-- No service key or customer details leave the database.
create or replace function public.pitacco_courier_background_assignments(p_token text)
returns jsonb
language plpgsql stable security definer set search_path=''
as $body$
declare v_courier uuid;v_data jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
   raise exception 'Autorização do plantão inválida' using errcode='42501';
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
 and cap.expires_at>now();
 if v_courier is null then
   raise exception 'Plantão expirado ou entregador offline' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'event_id',r.event_id)),'[]'::jsonb)
 into v_data
 from (
   select d.id,coalesce(outbox.event_id,d.id) event_id
   from public.deliveries d
   left join pitacco_private.courier_push_outbox outbox on outbox.delivery_id=d.id
   where d.courier_id=v_courier and d.logistics_provider='loja'
     and d.status='atribuida'
     and d.created_at>now()-interval '48 hours'
   order by d.created_at desc limit 60
 ) r;
 return v_data;
end;
$body$;
revoke all on function public.pitacco_courier_background_assignments(text) from public,anon,authenticated;
grant execute on function public.pitacco_courier_background_assignments(text) to anon,authenticated;
notify pgrst,'reload schema';
