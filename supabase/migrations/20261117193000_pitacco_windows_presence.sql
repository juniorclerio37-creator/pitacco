-- Sessões de atividade do aplicativo Windows. Não é detector de instalação do sistema operacional.
create table public.pitacco_windows_presence (
 store_id uuid not null references public.stores(id) on delete cascade,
 device_id uuid not null,
 signed_in_user uuid not null references auth.users(id),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 primary key(store_id,device_id)
);
create index pitacco_windows_presence_recent on public.pitacco_windows_presence(store_id,last_seen_at desc);
alter table public.pitacco_windows_presence enable row level security;
revoke all on public.pitacco_windows_presence from public,anon,authenticated;

create function public.pitacco_windows_ping(p_store uuid,p_device uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); entries integer; moment timestamptz:=clock_timestamp();
begin
 if actor is null or p_store is null or p_device is null
  or not public.is_store_manager(p_store) then
  raise exception 'Acesso não autorizado ao aplicativo Windows desta loja' using errcode='42501';
 end if;
 -- A presença nunca autoriza impressão, aceite ou troca de computador vinculado.
 perform 1 from public.stores where id=p_store for update;
 if not exists (select 1 from public.pitacco_windows_presence where store_id=p_store and device_id=p_device) then
  select count(*) into entries from public.pitacco_windows_presence where store_id=p_store;
  if entries>=10 then raise exception 'Limite de dispositivos registrados atingido';end if;
 end if;
 insert into public.pitacco_windows_presence(store_id,device_id,signed_in_user,last_seen_at)
 values(p_store,p_device,actor,moment)
 on conflict(store_id,device_id) do update
 set last_seen_at=excluded.last_seen_at,signed_in_user=excluded.signed_in_user;
 return jsonb_build_object('received',true,'time',moment);
end $$;
revoke all on function public.pitacco_windows_ping(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_windows_ping(uuid,uuid) to authenticated;

create function public.pitacco_windows_connection(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare latest timestamptz; bound_id uuid; connected_count integer; bound_live boolean;
begin
 if auth.uid() is null or p_store is null or not public.is_store_manager(p_store) then
  raise exception 'Acesso não autorizado ao status do Windows' using errcode='42501';
 end if;
 select max(last_seen_at),
   count(*) filter(where last_seen_at>=now()-interval '90 seconds')
 into latest,connected_count
 from public.pitacco_windows_presence where store_id=p_store;
 select device_id into bound_id from public.print_devices where store_id=p_store;
 bound_live:=bound_id is not null and exists(select 1 from public.pitacco_windows_presence
  where store_id=p_store and device_id=bound_id and last_seen_at>=now()-interval '90 seconds');
 return jsonb_build_object(
  'status',case when connected_count>0 then 'connected'
   when latest is not null or bound_id is not null then 'offline' else 'not_detected' end,
  'app_logged_in_now',connected_count>0,
  'last_seen_at',latest,
  'printer_computer_bound',bound_id is not null,
  'bound_computer_connected',bound_live,
  'automatic_print_tested',false,
  'installation_confirmed',false,
  'details','A presença significa que um aplicativo Windows autenticado enviou sinal recente; não prova instalação offline nem papel impresso.'
 );
end $$;
revoke all on function public.pitacco_windows_connection(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_windows_connection(uuid) to authenticated;
