
alter table public.pitacco_delivery_route_quotes add column if not exists delivery_service text not null default 'standard' check(delivery_service in ('standard','priority'));
alter table public.deliveries add column if not exists delivery_service text not null default 'standard' check(delivery_service in ('standard','priority'));
create or replace function pitacco_private.valid_area_priority(v jsonb, standard_fee numeric) returns boolean language sql immutable set search_path='' as $$
select case when v->'priority' is null or v->'priority'='null'::jsonb then true
when jsonb_typeof(v->'priority')='object' and v->'priority'->'enabled'='false'::jsonb then true
when jsonb_typeof(v->'priority')='object' and v->'priority'->'enabled'='true'::jsonb and pitacco_private.valid_area_time(v->'priority') and pitacco_private.valid_area_time(v) and jsonb_typeof(v->'priority'->'fee')='number' then
(v->'priority'->>'fee')::numeric between 0 and 999.99 and (v->'priority'->>'fee')::numeric>standard_fee and round((v->'priority'->>'fee')::numeric,2)=(v->'priority'->>'fee')::numeric and (v->'priority'->>'max_minutes')::numeric<(v->>'max_minutes')::numeric and (v->'priority'->>'min_minutes')::numeric<(v->>'min_minutes')::numeric
else false end
$$;
do $patch$
declare f text;
begin
 select pg_get_functiondef('public.pitacco_save_delivery_zone_times(uuid,integer,jsonb,jsonb)'::regprocedure) into f;
 f:=replace(f,'if not coalesce(pitacco_private.valid_area_time(p_times->i),false) then','if not coalesce(pitacco_private.valid_area_time(p_times->i),false) or not coalesce(pitacco_private.valid_area_priority(p_times->i,(p_distance->>i)::numeric),false) then');
 execute f;
 select pg_get_functiondef('public.pitacco_save_delivery_polygons_times(uuid,jsonb)'::regprocedure) into f;
 f:=replace(f,'if not coalesce(pitacco_private.valid_area_time(v),false) then','if not coalesce(pitacco_private.valid_area_time(v),false) or not coalesce(pitacco_private.valid_area_priority(v,(v->>''fee'')::numeric),false) then');
 f:=replace(f,'''max_minutes'',b.value->''max_minutes'')','''max_minutes'',b.value->''max_minutes'',''priority'',b.value->''priority'')');
 execute f;
 select pg_get_functiondef('pitacco_private.snapshot_delivery_eta()'::regprocedure) into f;
 f:=replace(f,'-''delivery_eta''','-''delivery_eta''-''delivery_service''');
 f:=replace(f,'x.request_id=new.request_id and','x.request_id=new.request_id and (x.id::text=nullif(current_setting(''pitacco.checkout_delivery_quote'',true),'''') or (x.delivery_service=''standard'' and nullif(current_setting(''pitacco.checkout_delivery_quote'',true),'''') is null)) and');
 f:=replace(f,'if found then','if found then
    if q.delivery_service=''priority'' and new.scheduled_for is not null then raise exception ''Entrega prioritária disponível apenas para pedidos imediatos'';end if;
    new.receipt:=new.receipt||jsonb_build_object(''delivery_service'',q.delivery_service);');
 execute f;
 select pg_get_functiondef('pitacco_private.group_copy_coordinates()'::regprocedure) into f;
 f:=replace(f,'loc:=rec->''delivery_location'';','loc:=rec->''delivery_location''; new.delivery_service:=case when new.source=''proprio'' and rec->>''delivery_service''=''priority'' then ''priority'' else ''standard'' end;');
 execute f;
end $patch$;
-- Prevent fee selection through a client-controlled order field. The quoted service is authoritative.
create or replace function pitacco_private.delivery_urgency(service text,due timestamptz,at_time timestamptz) returns integer language sql immutable set search_path='' as $$
select case when service='priority' and due<=at_time then 0 when due<=at_time then 1 when service='priority' then 2 when due<=at_time+interval '10 minutes' then 3 else 4 end
$$;
-- With no road routing, reserve an exclusive trip for an already urgent order.
-- Existing trips are not interrupted; the app reorders remaining stops.
do $patch$
declare f text;
begin
 select pg_get_functiondef('public.dg_assign_route(uuid,uuid,boolean,boolean)'::regprocedure) into f;
 f:=replace(f,'if b is not null then','if b is not null then
  if pitacco_private.delivery_urgency(rec.delivery_service,rec.deliver_by,now())<=2 or exists(select 1 from public.deliveries x where x.batch_id=b and x.status not in (''entregue'',''cancelada'') and x.capacity_released_at is null and pitacco_private.delivery_urgency(x.delivery_service,x.deliver_by,now())<=2) then raise exception ''Pedido prioritário ou atrasado precisa de viagem exclusiva'';end if;');
 execute f;
 select pg_get_functiondef('pitacco_private.group_auto_one(uuid)'::regprocedure) into f;
 f:=replace(f,' and (d.deliver_by is null or d.deliver_by>now())','');
 f:=replace(f,'count(a.id)=0 or (','count(a.id)=0 or (pitacco_private.delivery_urgency(d.delivery_service,d.deliver_by,now())>2 and coalesce(bool_and(pitacco_private.delivery_urgency(a.delivery_service,a.deliver_by,now())>2),false) and ');
 f:=replace(f,'order by d.deliver_by asc nulls last','order by pitacco_private.delivery_urgency(d.delivery_service,d.deliver_by,now()),d.deliver_by asc nulls last');
 execute f;
end $patch$;
revoke all on function pitacco_private.valid_area_priority(jsonb,numeric),pitacco_private.delivery_urgency(text,timestamptz,timestamptz) from public,anon,authenticated;

