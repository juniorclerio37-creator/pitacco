-- The weekly opening schedule is the sole source of future order slots.
alter table public.pitacco_store_hours add column if not exists accepts_scheduled boolean not null default false;
update public.pitacco_store_hours h set accepts_scheduled=true
where exists(select 1 from public.pitacco_schedule_windows w where w.store_id=h.store_id and w.enabled);
-- Existing schedules and orders are retained; only the setting is migrated.
create or replace function public.pitacco_public_schedule_slots(p_slug text,p_fulfillment text)
returns timestamptz[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct slot.time order by slot.time),array[]::timestamptz[])
 from public.public_menu_settings m
 join public.pitacco_store_hours h on h.store_id=m.store_id and h.accepts_scheduled and not h.paused
 cross join generate_series(-1,7) days(day)
 join public.pitacco_opening_periods p on p.store_id=m.store_id
  and p.weekday=extract(isodow from (now() at time zone 'America/Sao_Paulo')::date+days.day)
 cross join lateral generate_series(p.opens_minute::integer,
  p.closes_minute::integer+case when p.closes_minute<p.opens_minute then 1440 else 0 end-1,30) minutes(minute)
 cross join lateral (select (((now() at time zone 'America/Sao_Paulo')::date+days.day)::timestamp+
 make_interval(mins=>minutes.minute)) at time zone 'America/Sao_Paulo' as time) slot
 where m.slug=p_slug and m.enabled
 and ((p_fulfillment='delivery' and m.delivery_enabled) or (p_fulfillment='pickup' and m.pickup_enabled))
 and slot.time>=now()+make_interval(mins=>greatest(60,coalesce(m.preparation_minutes,30)+30))
 and slot.time<=now()+interval '7 days';
$$;
-- Preserve existing opening status implementation and consumers.
do $migration$
declare def text:=pg_get_functiondef('pitacco_private.store_opening_status(uuid,timestamptz)'::regprocedure);
 anchor constant text:=$a$'paused',config.paused,'manager_configured',config.manager_configured,$a$;
begin
 if strpos(def,anchor)=0 then raise exception 'Opening status anchor missing';end if;
 execute replace(def,anchor,anchor||$a$'accepts_scheduled',config.accepts_scheduled,'scheduling_available',config.accepts_scheduled and not config.paused and exists(select 1 from public.pitacco_opening_periods where store_id=p_store),$a$);
end $migration$;
create or replace function public.pitacco_store_hours_save_v2(p_store uuid,p_periods jsonb,p_paused boolean,p_expected_revision integer,p_accepts_scheduled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) or exists(select 1 from public.profiles where id=auth.uid() and role='entregador') then
 raise exception 'Sem permissão para modificar o funcionamento da loja' using errcode='42501';end if;
 if p_accepts_scheduled is null then raise exception 'Configuração de agendamento inválida';end if;
 saved:=public.pitacco_store_hours_save(p_store,p_periods,p_paused,p_expected_revision);
 update public.pitacco_store_hours set accepts_scheduled=p_accepts_scheduled where store_id=p_store;
 return saved||jsonb_build_object('current',pitacco_private.store_opening_status(p_store,now()));
end $$;
revoke all on function public.pitacco_store_hours_save_v2(uuid,jsonb,boolean,integer,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_store_hours_save_v2(uuid,jsonb,boolean,integer,boolean) to authenticated;
-- All scheduled checkout variants validate against exactly the same published slots.
-- The ordinary checkout still requires the store to be open at the current instant.
do $migration$
declare f regprocedure; def text;
 anchor constant text:='perform pitacco_private.require_store_open(cfg.store_id);';
begin
 foreach f in array array[
 'public.pitacco_checkout_scheduled_order(text,uuid,text,text,text,jsonb,text,text,text,timestamptz)'::regprocedure,
 'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
  def:=pg_get_functiondef(f);
  if strpos(def,anchor)=0 then raise exception 'Scheduled checkout anchor missing: %',f;end if;
  execute replace(def,anchor,$a$if not coalesce(p_scheduled_for=any(public.pitacco_public_schedule_slots(p_slug,p_fulfillment)),false) then
   raise exception 'Horário de agendamento indisponível';
  end if;$a$);
 end loop;
end $migration$;
notify pgrst,'reload schema';
