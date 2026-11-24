-- The existing device-scoped token also authorizes a minimal incident alert feed.
create or replace function public.pitacco_windows_incident_poll(p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_store uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Token inválido' using errcode='42501';end if;
 select w.store_id into v_store from pitacco_private.windows_order_watch w
 join auth.sessions se on se.id=w.session_id and se.user_id=w.user_id
 join auth.users u on u.id=w.user_id and (u.banned_until is null or u.banned_until<=now())
 where w.token_hash=extensions.digest(p_token,'sha256') and w.expires_at>now()
 and (exists(select 1 from public.profiles p where p.id=w.user_id and p.role='admin')
 or exists(select 1 from public.store_members m where m.store_id=w.store_id and m.user_id=w.user_id and m.role='gestor'));
 if v_store is null then raise exception 'Monitoramento expirado ou não autorizado' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',q.id)),'[]'::jsonb) from
 (select id from public.pitacco_delivery_incidents where store_id=v_store and state='open' and kind<>'other' order by created_at desc limit 100) q);
end $$;
revoke all on function public.pitacco_windows_incident_poll(text) from public,anon,authenticated;
grant execute on function public.pitacco_windows_incident_poll(text) to anon,authenticated;
