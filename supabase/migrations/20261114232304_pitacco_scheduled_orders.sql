create table public.pitacco_schedule_windows (
  store_id uuid not null references public.stores(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  enabled boolean not null default false,
  opens_minute smallint not null check (opens_minute between 0 and 1410 and opens_minute % 30 = 0),
  closes_minute smallint not null check (closes_minute between 30 and 1440 and closes_minute % 30 = 0),
  primary key (store_id, weekday),
  check (closes_minute > opens_minute)
);
alter table public.pitacco_schedule_windows enable row level security;
revoke all on public.pitacco_schedule_windows from public, anon, authenticated;
grant select, insert, update on public.pitacco_schedule_windows to authenticated;
create policy pitacco_schedule_manager on public.pitacco_schedule_windows for all to authenticated
  using (public.is_store_manager(store_id)) with check (public.is_store_manager(store_id));

alter table public.orders add column scheduled_for timestamptz,
  add column scheduled_release_at timestamptz,
  add constraint pitacco_schedule_consistent check (
    (scheduled_for is null and scheduled_release_at is null) or
    (scheduled_for is not null and scheduled_release_at is not null
      and scheduled_release_at < scheduled_for and source = 'proprio')
  );
create index pitacco_pending_scheduled_orders on public.orders (store_id, scheduled_release_at)
  where status = 'pending' and scheduled_release_at is not null;

create function public.pitacco_public_schedule_slots(p_slug text, p_fulfillment text)
returns timestamptz[] language sql stable security definer set search_path = '' as $function$
  select coalesce(array_agg(slot.time order by slot.time), array[]::timestamptz[])
  from public.public_menu_settings menu
  cross join generate_series(0,7) as days(offset_days)
  join public.pitacco_schedule_windows schedule
    on schedule.store_id = menu.store_id and schedule.enabled
   and schedule.weekday = extract(isodow from (now() at time zone 'America/Sao_Paulo')::date + days.offset_days)
  cross join lateral generate_series(schedule.opens_minute, schedule.closes_minute - 30, 30) as openings(minute)
  cross join lateral (
    select (((now() at time zone 'America/Sao_Paulo')::date + days.offset_days)::timestamp
      + make_interval(mins => openings.minute)) at time zone 'America/Sao_Paulo' as time
  ) slot
  where menu.slug = p_slug and menu.enabled
    and ((p_fulfillment='delivery' and menu.delivery_enabled) or (p_fulfillment='pickup' and menu.pickup_enabled))
    and slot.time >= now() + make_interval(mins => greatest(60,coalesce(menu.preparation_minutes,30)+30)) and slot.time <= now() + interval '7 days'
$function$;
revoke all on function public.pitacco_public_schedule_slots(text,text) from public;
grant execute on function public.pitacco_public_schedule_slots(text,text) to anon, authenticated;

-- Derive both scheduled endpoints from the deployed checkout implementations
-- so server prices, coupons, legacy flows and their existing guards stay intact.
do $migration$
declare
  source_function regprocedure;
  source_name text;
  destination_name text;
  definition text;
  trailing_arguments text;
  original_signature text;
  scheduled_signature text;
  checkout_snapshot constant text := $sql$'payment_status','pending','logistics',$sql$;
  persist_slot constant text := $sql$'payment_status','pending','scheduled_for',p_scheduled_for,'logistics',$sql$;
  lookup_menu constant text := $sql$ select * into cfg from public.public_menu_settings where slug=p_slug for update;$sql$;
  replay_salt constant text := $sql$ canonical:=canonical||jsonb_build_object('scheduled_for',p_scheduled_for at time zone 'UTC');
$sql$;
  before_products constant text := $sql$ for item in select value from jsonb_array_elements(normalized) loop$sql$;
  validate_slot constant text := $sql$
 if not coalesce(p_scheduled_for=any(public.pitacco_public_schedule_slots(p_slug,p_fulfillment)),false) then
  raise exception 'Horário de agendamento indisponível';
 end if;
$sql$;
  order_columns constant text := $sql$status,request_id,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,jsonb_build_object$sql$;
  scheduled_columns constant text := $sql$status,request_id,scheduled_for,scheduled_release_at,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,p_scheduled_for,p_scheduled_for-make_interval(mins => greatest(1,coalesce(cfg.preparation_minutes,30))),jsonb_build_object$sql$;
  auto_accept constant text := $sql$ if exists(select 1 from public.acceptance_settings where store_id=cfg.store_id and source='proprio' and mode='automatic' and enabled) then perform public.dg_accept_own(oid);end if;$sql$;
begin
  foreach source_function in array array[
    'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
    'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure
  ] loop
    select proname into source_name from pg_proc where oid=source_function;
    if source_name = 'checkout_public_order_coupon' then
      destination_name := 'pitacco_checkout_scheduled_order_coupon';
      trailing_arguments := 'text,';
      original_signature := 'p_coupon text)';
      scheduled_signature := 'p_coupon text, p_scheduled_for timestamp with time zone)';
    else
      destination_name := 'pitacco_checkout_scheduled_order';
      trailing_arguments := '';
      original_signature := 'p_notes text DEFAULT ''''::text)';
      scheduled_signature := 'p_notes text, p_scheduled_for timestamp with time zone)';
    end if;
    definition := pg_get_functiondef(source_function);
    if strpos(definition, original_signature)=0 or strpos(definition, checkout_snapshot)=0
       or strpos(definition, lookup_menu)=0 or strpos(definition, before_products)=0
       or strpos(definition, order_columns)=0 or strpos(definition, auto_accept)=0 then
      raise exception 'Checkout % difere da versão de referência', source_function;
    end if;
    definition := replace(definition, 'FUNCTION public.'||source_name||'(', 'FUNCTION public.'||destination_name||'(');
    definition := replace(definition, original_signature, scheduled_signature);
    definition := replace(definition, lookup_menu, replay_salt||lookup_menu);
    definition := replace(definition, before_products, validate_slot||before_products);
    definition := replace(definition, order_columns, scheduled_columns);
    definition := replace(definition, checkout_snapshot, persist_slot);
    definition := replace(definition, auto_accept, '');
    execute definition;
    execute format('revoke all on function public.%I(text,uuid,text,text,text,jsonb,text,text,text,%stimestamptz) from public',destination_name,trailing_arguments);
    execute format('grant execute on function public.%I(text,uuid,text,text,text,jsonb,text,text,text,%stimestamptz) to anon, authenticated',destination_name,trailing_arguments);
  end loop;
end;
$migration$;

create function pitacco_private.pitacco_enforce_schedule_release() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if new.status = 'accepted' and old.status <> 'accepted' and old.scheduled_release_at > now() then
    raise exception 'Pedido agendado ainda não foi liberado para preparo';
  end if;
  return new;
end;
$function$;
revoke all on function pitacco_private.pitacco_enforce_schedule_release() from public, anon, authenticated;
create trigger pitacco_enforce_schedule_release before update of status on public.orders
  for each row when (old.scheduled_release_at is not null)
  execute function pitacco_private.pitacco_enforce_schedule_release();

do $migration$
declare
  definition text := pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure);
  tracking_key constant text := $sql$'created_at',o.created_at,'accepted_at',o.accepted_at,$sql$;
begin
  if strpos(definition,tracking_key)=0 then
    raise exception 'Acompanhamento público difere da versão de referência';
  end if;
  execute replace(definition,tracking_key,tracking_key||$sql$'scheduled_for',o.scheduled_for,$sql$);
end;
$migration$;
