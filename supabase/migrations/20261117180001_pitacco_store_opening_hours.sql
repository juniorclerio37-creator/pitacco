-- Weekly merchant opening hours, separate from future-order appointment slots.
-- Existing stores are left accepting orders through a 24h legacy schedule.
-- Newly created stores have no schedule and cannot accept storefront orders until configured.
create table public.pitacco_store_hours (
 store_id uuid primary key references public.stores(id) on delete cascade,
 paused boolean not null default false,
 manager_configured boolean not null default false,
 revision integer not null default 0 check(revision>=0),
 updated_at timestamptz not null default now()
);
create table public.pitacco_opening_periods (
 store_id uuid not null references public.stores(id) on delete cascade,
 weekday smallint not null check(weekday between 1 and 7),
 slot smallint not null check(slot between 1 and 3),
 opens_minute smallint not null check(opens_minute between 0 and 1439),
 closes_minute smallint not null check(closes_minute between 0 and 1440),
 primary key(store_id,weekday,slot),
 check(opens_minute<>closes_minute)
);
create index pitacco_opening_periods_week on public.pitacco_opening_periods(store_id,weekday);
alter table public.pitacco_store_hours enable row level security;
alter table public.pitacco_opening_periods enable row level security;
revoke all on public.pitacco_store_hours from public,anon,authenticated;
revoke all on public.pitacco_opening_periods from public,anon,authenticated;
-- Preserve published and existing storefronts, without silently imposing assumed closing times.
insert into public.pitacco_store_hours(store_id,manager_configured)
 select id,false from public.stores on conflict do nothing;
insert into public.pitacco_opening_periods(store_id,weekday,slot,opens_minute,closes_minute)
 select s.id,w.weekday,1,0,1440 from public.stores s cross join generate_series(1,7) as w(weekday)
 on conflict do nothing;

-- Onboarding defaults to a visible 24h schedule, preserving new-store checkout
-- compatibility. The admin screen prominently asks managers to set real operating hours.
create function pitacco_private.seed_store_opening_hours()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.pitacco_store_hours(store_id,manager_configured)
 values(new.id,false) on conflict do nothing;
 insert into public.pitacco_opening_periods(store_id,weekday,slot,opens_minute,closes_minute)
 select new.id,d.day,1,0,1440 from generate_series(1,7) as d(day)
 on conflict do nothing;
 return new;
end $$;
revoke all on function pitacco_private.seed_store_opening_hours() from public,anon,authenticated;
create trigger pitacco_store_seed_opening_hours
 after insert on public.stores
 for each row execute function pitacco_private.seed_store_opening_hours();

create function pitacco_private.store_opening_status(p_store uuid,p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config public.pitacco_store_hours%rowtype;
 local_at timestamp:=p_at at time zone 'America/Sao_Paulo';
 iso_weekday integer; minute_of_day integer; is_open boolean:=false; next_at timestamptz;
 today jsonb;
begin
 select * into config from public.pitacco_store_hours where store_id=p_store;
 if not found then
  return jsonb_build_object('open',false,'reason','unconfigured','paused',false,'manager_configured',false,
   'timezone','America/Sao_Paulo','today','[]'::jsonb,'next_open_at',null);
 end if;
 iso_weekday:=extract(isodow from local_at)::integer;
 minute_of_day:=extract(hour from local_at)::integer*60+extract(minute from local_at)::integer;
 select exists(
  select 1 from public.pitacco_opening_periods p where p.store_id=p_store and (
   (p.weekday=iso_weekday and p.closes_minute>p.opens_minute
       and minute_of_day>=p.opens_minute and minute_of_day<p.closes_minute)
   or (p.weekday=iso_weekday and p.closes_minute<p.opens_minute and minute_of_day>=p.opens_minute)
   or (p.weekday=case when iso_weekday=1 then 7 else iso_weekday-1 end
       and p.closes_minute<p.opens_minute and minute_of_day<p.closes_minute)
  )
 ) into is_open;
 select coalesce(jsonb_agg(jsonb_build_object('opens_minute',p.opens_minute,'closes_minute',p.closes_minute)
   order by p.opens_minute),'[]'::jsonb) into today
 from public.pitacco_opening_periods p where p.store_id=p_store and p.weekday=iso_weekday;
 if not is_open and not config.paused then
  select min(candidate.next_open) into next_at from (
   select (((local_at::date+dates.day)::timestamp+make_interval(mins=>p.opens_minute))
    at time zone 'America/Sao_Paulo') as next_open
   from generate_series(0,7) as dates(day)
   join public.pitacco_opening_periods p
    on p.store_id=p_store and p.weekday=extract(isodow from local_at::date+dates.day)::integer
  ) candidate where candidate.next_open>p_at;
 end if;
 return jsonb_build_object(
  'open',is_open and not config.paused,
  'reason',case when config.paused then 'paused' when is_open then 'open' else 'outside_hours' end,
  'paused',config.paused,'manager_configured',config.manager_configured,
  'timezone','America/Sao_Paulo','today',today,'next_open_at',next_at
 );
end $$;
revoke all on function pitacco_private.store_opening_status(uuid,timestamptz) from public,anon,authenticated;

create function pitacco_private.require_store_open(p_store uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare s jsonb;
begin
 s:=pitacco_private.store_opening_status(p_store,now());
 if (s->>'open')::boolean is distinct from true then
  raise exception 'Loja fechada no momento. Consulte o horário de funcionamento antes de pedir'
  using errcode='P0001';
 end if;
end $$;
revoke all on function pitacco_private.require_store_open(uuid) from public,anon,authenticated;

create function public.pitacco_public_store_open(p_slug text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_store uuid;
begin
 select store_id into v_store from public.public_menu_settings where slug=p_slug and enabled;
 if v_store is null then raise exception 'Cardápio indisponível';end if;
 return pitacco_private.store_opening_status(v_store,now());
end $$;
revoke all on function public.pitacco_public_store_open(text) from public,anon,authenticated;
grant execute on function public.pitacco_public_store_open(text) to anon,authenticated;

create function public.pitacco_store_hours_state(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg public.pitacco_store_hours%rowtype; windows jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem permissão para consultar o funcionamento da loja' using errcode='42501';end if;
 select * into cfg from public.pitacco_store_hours where store_id=p_store;
 select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'slot',slot,
   'opens_minute',opens_minute,'closes_minute',closes_minute) order by weekday,slot),'[]'::jsonb)
  into windows from public.pitacco_opening_periods where store_id=p_store;
 return jsonb_build_object('periods',windows,'paused',coalesce(cfg.paused,false),
  'manager_configured',coalesce(cfg.manager_configured,false),
  'revision',coalesce(cfg.revision,0),
  'current',pitacco_private.store_opening_status(p_store,now()));
end $$;
revoke all on function public.pitacco_store_hours_state(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_hours_state(uuid) to authenticated;

create function public.pitacco_store_hours_save(p_store uuid,p_periods jsonb,p_paused boolean,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_revision integer; item jsonb;
 day_no integer; slot_no integer; start_at integer; finish_at integer; overlap_found boolean;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem permissão para modificar o funcionamento da loja' using errcode='42501';end if;
 if p_paused is null or p_periods is null or jsonb_typeof(p_periods)<>'array'
  or jsonb_array_length(p_periods)>21 then raise exception 'Horários inválidos';end if;
 -- Same lock ordering as checkout_public_order, preventing race conditions with checkout.
 perform 1 from public.public_menu_settings where store_id=p_store for update;
 insert into public.pitacco_store_hours(store_id) values(p_store) on conflict do nothing;
 select revision into current_revision from public.pitacco_store_hours where store_id=p_store for update;
 if current_revision is distinct from p_expected_revision then
  raise exception 'Horários alterados em outro dispositivo. Recarregue antes de salvar';end if;
 delete from public.pitacco_opening_periods where store_id=p_store;
 for item in select value from jsonb_array_elements(p_periods) loop
  if jsonb_typeof(item)<>'object' or not(item ?& array['weekday','slot','opens_minute','closes_minute'])
   or item-array['weekday','slot','opens_minute','closes_minute']<>'{}'::jsonb then
   raise exception 'Período incompleto ou inválido';end if;
  day_no:=(item->>'weekday')::integer;slot_no:=(item->>'slot')::integer;
  start_at:=(item->>'opens_minute')::integer;finish_at:=(item->>'closes_minute')::integer;
  if day_no not between 1 and 7 or slot_no not between 1 and 3
   or start_at not between 0 and 1439 or finish_at not between 0 and 1440
   or start_at=finish_at then raise exception 'Horário fora dos limites';end if;
  insert into public.pitacco_opening_periods(store_id,weekday,slot,opens_minute,closes_minute)
   values(p_store,day_no,slot_no,start_at,finish_at);
 end loop;
 -- Reject overlapping intervals even across midnight and Sunday -> Monday.
 with ranges as (
  select weekday,slot,
   ((weekday-1)*1440+opens_minute) as begins_at,
   ((weekday-1)*1440+closes_minute+
     case when closes_minute<opens_minute then 1440 else 0 end) as ends_at
  from public.pitacco_opening_periods where store_id=p_store
 )
 select exists(select 1 from ranges a join ranges b on (a.weekday,a.slot)<(b.weekday,b.slot)
  where (a.begins_at<b.ends_at and b.begins_at<a.ends_at)
   or (a.begins_at<b.ends_at-10080 and b.begins_at-10080<a.ends_at)
   or (a.begins_at<b.ends_at+10080 and b.begins_at+10080<a.ends_at))
 into overlap_found;
 if overlap_found then raise exception 'Há horários de funcionamento sobrepostos';end if;
 update public.pitacco_store_hours set paused=p_paused,
  manager_configured=(manager_configured or paused=p_paused),
  revision=revision+1,updated_at=now() where store_id=p_store;
 return jsonb_build_object('saved',true,'revision',current_revision+1,
  'current',pitacco_private.store_opening_status(p_store,now()));
end $$;
revoke all on function public.pitacco_store_hours_save(uuid,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function public.pitacco_store_hours_save(uuid,jsonb,boolean,integer) to authenticated;

-- Expose the status inside public menu as a read-only UX hint. This does not replace the checkout guard.
do $patch_public_menu$
declare source text; marker constant text:='''delivery_enabled'',cfg.delivery_enabled';
begin
 source:=pg_get_functiondef('public.get_public_menu(text)'::regprocedure);
 if strpos(source,'''opening_hours'',pitacco_private.store_opening_status')>0 then return;end if;
 if strpos(source,marker)=0 then raise exception 'Public menu function changed unexpectedly';end if;
 execute replace(source,marker,
  '''opening_hours'',pitacco_private.store_opening_status(cfg.store_id,now()),'||marker);
end $patch_public_menu$;

-- Explicitly protect all four entry points; wrappers for map/quote call these.
-- Keep request-id replay check before the guard, so a previously created order remains retrievable.
do $patch_checkout$
declare f regprocedure; definition text;
 needle constant text:='if not cfg.enabled or';
begin
 foreach f in array array[
  'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
  'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
  'public.pitacco_checkout_scheduled_order(text,uuid,text,text,text,jsonb,text,text,text,timestamptz)'::regprocedure,
  'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(f);
  if strpos(definition,'perform pitacco_private.require_store_open(cfg.store_id)')>0 then continue;end if;
  if strpos(definition,needle)=0 then raise exception 'Checkout function changed: %',f;end if;
  execute replace(definition,needle,
    'perform pitacco_private.require_store_open(cfg.store_id);'||chr(10)||' '||needle);
 end loop;
end $patch_checkout$;
