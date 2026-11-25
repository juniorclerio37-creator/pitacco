-- Separate the manual acceptance of an appointment from the time preparation may begin.
do $migration$
declare def text:=pg_get_functiondef('public.dg_accept_own(uuid)'::regprocedure);
 anchor constant text:='if o.status=''accepted'' then return o.id; end if;';
 receipt_anchor constant text:='update public.orders set status=''accepted'',accepted_at=now(),accepted_by=auth.uid(),receipt=r where id=o.id;';
begin
 if strpos(def,anchor)=0 or strpos(def,receipt_anchor)=0 then raise exception 'Unexpected own acceptance definition';end if;
 def:=replace(def,'FUNCTION public.dg_accept_own(p_order uuid)','FUNCTION pitacco_private.accept_own_with_schedule(p_order uuid, p_manual boolean)');
 def:=replace(def,anchor,anchor||$guard$
 if o.scheduled_for is not null and (not p_manual or auth.uid() is null or not public.is_store_manager(o.store_id)
   or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='entregador')) then
  raise exception 'Pedido agendado exige aceite manual da loja' using errcode='42501';
 end if;
$guard$);
 def:=replace(def,receipt_anchor,$receipt$
 if o.scheduled_for is not null then
  r:=r||jsonb_build_object('scheduled_for',o.scheduled_for,'scheduled_release_at',o.scheduled_release_at,
    'scheduled_label',to_char(o.scheduled_for at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'),
    'scheduled_release_label',to_char(o.scheduled_release_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI'));
 end if;
$receipt$||receipt_anchor);
 execute def;
end $migration$;
revoke all on function pitacco_private.accept_own_with_schedule(uuid,boolean) from public,anon,authenticated,service_role;
create or replace function public.dg_accept_own(p_order uuid) returns uuid
language sql security definer set search_path='' as $$
 select pitacco_private.accept_own_with_schedule(p_order,false);
$$;
create or replace function public.accept_order(p_order uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 select store_id into s from public.orders where id=p_order;
 if s is null or not public.is_store_manager(s) or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='entregador') then raise exception 'Sem permissao';end if;
 return pitacco_private.accept_own_with_schedule(p_order,true);
end $$;
create or replace function pitacco_private.pitacco_enforce_schedule_release() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.status='accepted' and old.status<>'accepted' and
 (auth.uid() is null or new.accepted_by is distinct from auth.uid() or not public.is_store_manager(old.store_id)) then
  raise exception 'Pedido agendado exige aceite manual da loja' using errcode='42501';
 end if;
 if new.preparation_status is distinct from old.preparation_status and new.preparation_status in ('ready','completed') and old.scheduled_release_at>now() then
  raise exception 'Pedido agendado ainda não foi liberado para preparo';
 end if;
 return new;
end $$;
drop trigger pitacco_enforce_schedule_release on public.orders;
create trigger pitacco_enforce_schedule_release before update of status,preparation_status on public.orders
 for each row when (old.scheduled_release_at is not null) execute function pitacco_private.pitacco_enforce_schedule_release();
-- Surface the preparation release instant in the existing token-scoped tracking endpoint.
do $migration$
declare def text:=pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure);
begin
 if strpos(def,'''scheduled_for'',o.scheduled_for,')=0 then raise exception 'Tracking schedule anchor missing';end if;
 execute replace(def,'''scheduled_for'',o.scheduled_for,','''scheduled_for'',o.scheduled_for,''scheduled_release_at'',o.scheduled_release_at,');
end $migration$;
-- The background monitor must notify as soon as a scheduled order arrives.
do $migration$
declare def text:=pg_get_functiondef('public.pitacco_windows_watch_poll(text)'::regprocedure);
 anchor constant text:=$a$and (to_jsonb(o)->>'scheduled_release_at' is null
       or (to_jsonb(o)->>'scheduled_release_at')::timestamptz <= now())$a$;
begin
 if strpos(def,anchor)=0 then raise exception 'Unexpected Windows watch schedule predicate';end if;
 execute replace(def,anchor,'');
end $migration$;
-- Server-rendered text fallback; keep the explicit timezone-formatted receipt snapshot.
do $migration$
declare def text:=pg_get_functiondef('public.dg_receipt_text(jsonb)'::regprocedure);
 anchor constant text:='  display_num := coalesce(';
begin
 if strpos(def,anchor)=0 then raise exception 'Receipt anchor missing';end if;
 execute replace(def,anchor,$a$  if nullif(r->>'scheduled_for','') is not null then
    result:=result || '*** PEDIDO AGENDADO ***' || chr(10)
      || 'Modalidade: ' || case when r->>'logistics'='retirada' then 'RETIRADA' else 'ENTREGA' end || chr(10)
      || 'Agendamento: ' || coalesce(r->>'scheduled_label',r->>'scheduled_for') || chr(10)
      || 'PRODUCAO CONFORME AGENDAMENTO' || chr(10);
    if nullif(r->>'scheduled_release_label','') is not null then result:=result||'Inicio do preparo: '||(r->>'scheduled_release_label')||chr(10);end if;
  end if;
$a$||anchor);
end $migration$;
notify pgrst,'reload schema';
