-- Minimal authenticated push diagnostic events. Never store an FCM token,
-- customer/order details, notification message text or secrets here.
create table if not exists pitacco_private.courier_push_diagnostic_event (
 id bigint generated always as identity primary key,
 courier_id uuid not null references public.couriers(id) on delete cascade,
 stage text not null check(stage in (
   'boot','bridge_ready','bridge_absent','request_token','native_message',
   'permission_blocked','channel_blocked','firebase_unavailable',
   'firebase_failed','token_received','register_error','register_ok',
   'readiness_error','ready','timeout','network_retry'
 )),
 error_code text not null default '' check(length(error_code)<=24),
 created_at timestamptz not null default now()
);
create index if not exists courier_push_diag_recent
 on pitacco_private.courier_push_diagnostic_event(courier_id, created_at desc);
revoke all on table pitacco_private.courier_push_diagnostic_event
 from public,anon,authenticated;
revoke all on sequence pitacco_private.courier_push_diagnostic_event_id_seq
 from public,anon,authenticated;

create or replace function public.pitacco_courier_push_diagnostic(
 p_stage text, p_code text default ''
) returns void
language plpgsql security definer set search_path to ''
as $$
declare v_courier uuid;
begin
 if (select auth.uid()) is null or
    not public.pitacco_courier_session_ready() then
  raise exception 'Sessão inválida' using errcode='42501';
 end if;
 if p_stage is null or p_stage not in (
   'boot','bridge_ready','bridge_absent','request_token','native_message',
   'permission_blocked','channel_blocked','firebase_unavailable',
   'firebase_failed','token_received','register_error','register_ok',
   'readiness_error','ready','timeout','network_retry'
 ) then raise exception 'Etapa inválida' using errcode='22023'; end if;
 select c.id into strict v_courier
 from public.couriers c where c.user_id=(select auth.uid()) and c.active;
 -- Only a fixed stage and a restricted error *code*; never transmit tokens.
 if (select count(*) from pitacco_private.courier_push_diagnostic_event e
     where e.courier_id=v_courier and e.created_at>now()-interval '1 hour')>140
 then return; end if;
 insert into pitacco_private.courier_push_diagnostic_event
  (courier_id,stage,error_code)
 values(v_courier,p_stage,
  case when coalesce(p_code,'') ~ '^[A-Za-z0-9_-]{1,24}$'
   then p_code else '' end);
end $$;
revoke all on function public.pitacco_courier_push_diagnostic(text,text)
 from public,anon;
grant execute on function public.pitacco_courier_push_diagnostic(text,text)
 to authenticated;
