-- Public storefront availability follows the existing effective order gate.
-- Preserve the merchant's opening-hours configuration and do not expose billing data.
create or replace function pitacco_private.public_store_opening_status(p_store uuid)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select pitacco_private.store_opening_status(p_store,now()) ||
 case when coalesce((pitacco_private.control_store_order_gate(p_store)->>'orders_blocked')::boolean,false)
 then jsonb_build_object('open',false,'reason','paused','paused',true,'accepts_scheduled',false,'scheduling_available',false,'next_open_at',null)
 else '{}'::jsonb end
$fn$;
revoke all on function pitacco_private.public_store_opening_status(uuid) from public,anon,authenticated;
do $patch$
declare d text; a text; b text;
begin
 select pg_get_functiondef('public.get_public_menu(text)'::regprocedure) into d;
 a:='pitacco_private.store_opening_status(cfg.store_id,now())';
 b:='pitacco_private.public_store_opening_status(cfg.store_id)';
 if strpos(d,a)>0 then execute replace(d,a,b);elsif strpos(d,b)=0 then raise exception 'Public menu opening anchor missing';end if;
 select pg_get_functiondef('public.pitacco_public_store_open(text)'::regprocedure) into d;
 a:='pitacco_private.store_opening_status(v_store,now())';
 b:='pitacco_private.public_store_opening_status(v_store)';
 if strpos(d,a)>0 then execute replace(d,a,b);elsif strpos(d,b)=0 then raise exception 'Public opening anchor missing';end if;
 select pg_get_functiondef('public.pitacco_public_schedule_slots(text,text)'::regprocedure) into d;
 a:='where m.slug=p_slug and m.enabled';
 b:=a||' and not coalesce((pitacco_private.control_store_order_gate(m.store_id)->>''orders_blocked'')::boolean,false)';
 if strpos(d,b)=0 then
  if strpos(d,a)=0 then raise exception 'Public schedule anchor missing';end if;
  execute replace(d,a,b);
 end if;
end $patch$;
do $verify$ begin
 assert has_function_privilege('anon','public.get_public_menu(text)','EXECUTE');
 assert has_function_privilege('anon','public.pitacco_public_store_open(text)','EXECUTE');
 assert has_function_privilege('anon','public.pitacco_public_schedule_slots(text,text)','EXECUTE');
 assert not has_function_privilege('anon','pitacco_private.public_store_opening_status(uuid)','EXECUTE');
end $verify$;
