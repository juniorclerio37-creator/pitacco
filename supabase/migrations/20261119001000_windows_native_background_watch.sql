-- Windows native background order watcher. Single authenticated device-scoped
-- capability, hashed at rest, no service-role credentials on merchant computers.
-- The Tauri process polls pending order IDs independently of the WebView.
create table if not exists pitacco_private.windows_order_watch (
 user_id uuid not null references auth.users(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 session_id uuid not null,
 token_hash bytea not null unique,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 primary key(user_id,store_id)
);
revoke all on pitacco_private.windows_order_watch from public,anon,authenticated;

create or replace function public.pitacco_windows_watch_start(p_store uuid)
returns text language plpgsql security definer set search_path='' as $body$
declare v_user uuid:=(select auth.uid());v_session uuid;
 v_token text;
begin
 if v_user is null or p_store is null or not public.is_store_manager(p_store)
    or not exists(select 1 from public.stores s where s.id=p_store) then
  raise exception 'Acesso não autorizado à loja' using errcode='42501';
 end if;
 v_session:=(select auth.jwt()->>'session_id')::uuid;
 if v_session is null or not exists(
   select 1 from auth.sessions se where se.id=v_session and se.user_id=v_user
 ) then raise exception 'Sessão inválida' using errcode='42501'; end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into pitacco_private.windows_order_watch(user_id,store_id,session_id,token_hash,expires_at)
 values(v_user,p_store,v_session,extensions.digest(v_token,'sha256'),now()+interval '18 hours')
 on conflict(user_id,store_id) do update set session_id=excluded.session_id,
  token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now();
 return v_token;
end $body$;
revoke all on function public.pitacco_windows_watch_start(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_windows_watch_start(uuid) to authenticated;

create or replace function public.pitacco_windows_watch_stop(p_store uuid)
returns void language plpgsql security definer set search_path='' as $body$
begin
 delete from pitacco_private.windows_order_watch w
 where w.user_id=(select auth.uid()) and w.store_id=p_store
 and w.session_id::text=(select auth.jwt()->>'session_id');
end $body$;
revoke all on function public.pitacco_windows_watch_stop(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_windows_watch_stop(uuid) to authenticated;

create or replace function public.pitacco_windows_watch_poll(p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare v_store uuid;v_result jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
   raise exception 'Token de monitoramento inválido' using errcode='42501';
 end if;
 select w.store_id into v_store from pitacco_private.windows_order_watch w
 join auth.sessions se on se.id=w.session_id and se.user_id=w.user_id
 join auth.users u on u.id=w.user_id and (u.banned_until is null or u.banned_until<=now())
 where w.token_hash=extensions.digest(p_token,'sha256') and w.expires_at>now()
 and (
  exists(select 1 from public.profiles p where p.id=w.user_id and p.role='admin')
  or exists(select 1 from public.store_members m where m.store_id=w.store_id
      and m.user_id=w.user_id and m.role='gestor')
 )
 and exists(select 1 from public.stores s where s.id=w.store_id);
 if v_store is null then
  raise exception 'Monitoramento expirado ou não autorizado' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'created_at',q.created_at)),'[]'::jsonb)
 into v_result
 from (
  select o.id,o.created_at from public.orders o
  where o.store_id=v_store and o.status='pending'
   and (to_jsonb(o)->>'scheduled_release_at' is null
       or (to_jsonb(o)->>'scheduled_release_at')::timestamptz <= now())
  order by o.created_at desc limit 60
 ) q;
 return v_result;
end $body$;
revoke all on function public.pitacco_windows_watch_poll(text) from public,anon,authenticated;
grant execute on function public.pitacco_windows_watch_poll(text) to anon,authenticated;
notify pgrst,'reload schema';
