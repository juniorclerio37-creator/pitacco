-- Keep the provider integration connected. Suppress only new orders received while Pitacco is blocked.
create table if not exists pitacco_private.ifood_suppressed_orders(
 merchant_id uuid not null,
 external_order_id uuid not null,
 suppressed_at timestamptz not null default now(),
 primary key(merchant_id,external_order_id)
);
alter table pitacco_private.ifood_suppressed_orders enable row level security;
revoke all on pitacco_private.ifood_suppressed_orders from public,anon,authenticated;
create or replace function pitacco_private.ifood_suppress_new_order(p_merchant uuid,p_order uuid)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare s uuid;
begin
 if exists(select 1 from pitacco_private.ifood_order_links where merchant_id=p_merchant and external_id=p_order) then return false;end if;
 if exists(select 1 from pitacco_private.ifood_suppressed_orders where merchant_id=p_merchant and external_order_id=p_order) then return true;end if;
 select store_id into s from pitacco_private.ifood_merchants where merchant_id=p_merchant and enabled;
 if s is null or not coalesce((pitacco_private.control_store_order_gate(s)->>'orders_blocked')::boolean,false) then return false;end if;
 insert into pitacco_private.ifood_suppressed_orders(merchant_id,external_order_id) values(p_merchant,p_order) on conflict do nothing;
 return true;
end $fn$;
revoke all on function pitacco_private.ifood_suppress_new_order(uuid,uuid) from public,anon,authenticated;
create or replace function pitacco_private.ifood_ignore_blocked_event()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if pitacco_private.ifood_suppress_new_order(new.merchant_id,new.order_id) then new.done_at:=now();new.lease:=null;end if;
 return new;
end $fn$;
revoke all on function pitacco_private.ifood_ignore_blocked_event() from public,anon,authenticated;
drop trigger if exists pitacco_ifood_ignore_blocked_event on pitacco_private.ifood_events;
create trigger pitacco_ifood_ignore_blocked_event before insert on pitacco_private.ifood_events for each row execute function pitacco_private.ifood_ignore_blocked_event();
-- Existing queued events can also encounter a block between receipt and processing.
do $patch$
declare d text; a text; b text;
begin
 select pg_get_functiondef('public.pitacco_ifood_complete(uuid,uuid,jsonb,boolean)'::regprocedure) into d;
 d:=replace(d,chr(13),'');
 a:='if not found then return; end if;'||chr(10)||'  if p_order is null then';
 b:='if not found then return; end if;'||chr(10)||$new$  if pitacco_private.ifood_suppress_new_order(e.merchant_id,e.order_id) then
    update pitacco_private.ifood_events set done_at=now(),lease=null where id=e.id;
    return;
  end if;
  if p_order is null then$new$;
 b:=replace(b,chr(13),'');
 if strpos(d,a)>0 then execute replace(d,a,b);elsif strpos(d,b)=0 then raise exception 'iFood completion guard anchor missing';end if;
end $patch$;
-- Close queued events for stores already blocked at migration time, preserving existing orders.
update pitacco_private.ifood_events e set done_at=now(),lease=null
where e.done_at is null and pitacco_private.ifood_suppress_new_order(e.merchant_id,e.order_id);
do $verify$ begin
 assert not has_table_privilege('anon','pitacco_private.ifood_suppressed_orders','SELECT');
 assert not has_table_privilege('authenticated','pitacco_private.ifood_suppressed_orders','SELECT');
 assert not has_function_privilege('authenticated','pitacco_private.ifood_suppress_new_order(uuid,uuid)','EXECUTE');
end $verify$;
