begin;
insert into auth.users(id,email) values
 ('d1000000-0000-0000-0000-000000000001','hours-manager@example.invalid'),
 ('d1000000-0000-0000-0000-000000000002','hours-other@example.invalid');
insert into public.stores(id,name) values
 ('d2000000-0000-0000-0000-000000000001','Loja Horários'),
 ('d2000000-0000-0000-0000-000000000002','Outra Loja');
insert into public.store_members(store_id,user_id,role) values
 ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','gestor'),
 ('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','gestor');
insert into public.public_menu_settings(store_id,slug,enabled,delivery_enabled,pickup_enabled,delivery_fee,payment_methods,pix_instructions)
 values('d2000000-0000-0000-0000-000000000001','horarios-loja',true,false,true,0,array['dinheiro'],'')
 on conflict(store_id) do update set slug=excluded.slug,enabled=excluded.enabled,
  delivery_enabled=excluded.delivery_enabled,pickup_enabled=excluded.pickup_enabled,
  delivery_fee=excluded.delivery_fee,payment_methods=excluded.payment_methods;
insert into public.products(id,store_id,name,price,cost,menu_active)
 values('d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',
 'Açaí 500 ml',20,4,true);

-- Test-only privileged clock injection; this function disappears at ROLLBACK.
create function public.pitacco_test_hours_at(p_store uuid,p_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
 select pitacco_private.store_opening_status(p_store,p_at)
$$;
revoke all on function public.pitacco_test_hours_at(uuid,timestamptz) from public,anon;
grant execute on function public.pitacco_test_hours_at(uuid,timestamptz) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
do $test$
declare initial jsonb; first jsonb; state jsonb; windows jsonb;
begin
 initial:=public.pitacco_store_hours_state('d2000000-0000-0000-0000-000000000001');
 assert initial->>'revision'='0';
 assert initial->>'manager_configured'='false';
 assert jsonb_array_length(initial->'periods')=7;
 first:=public.pitacco_store_hours_save('d2000000-0000-0000-0000-000000000001',
  '[{"weekday":1,"slot":1,"opens_minute":720,"closes_minute":840},
    {"weekday":1,"slot":2,"opens_minute":1080,"closes_minute":1320},
    {"weekday":5,"slot":1,"opens_minute":1200,"closes_minute":120},
    {"weekday":7,"slot":1,"opens_minute":0,"closes_minute":1440}]'::jsonb,false,0);
 assert first->>'revision'='1';
 state:=public.pitacco_test_hours_at('d2000000-0000-0000-0000-000000000001','2026-11-16 12:00:00-03');
 assert state->>'open'='true','Monday at opening should accept orders';
 state:=public.pitacco_test_hours_at('d2000000-0000-0000-0000-000000000001','2026-11-16 14:00:00-03');
 assert state->>'open'='false','At closing boundary should stop orders';
 state:=public.pitacco_test_hours_at('d2000000-0000-0000-0000-000000000001','2026-11-16 18:00:00-03');
 assert state->>'open'='true','Second shift opens';
 state:=public.pitacco_test_hours_at('d2000000-0000-0000-0000-000000000001','2026-11-21 01:30:00-03');
 assert state->>'open'='true','Friday overnight service extends into Saturday';
 state:=public.pitacco_test_hours_at('d2000000-0000-0000-0000-000000000001','2026-11-21 02:00:00-03');
 assert state->>'open'='false','Overnight closing boundary blocks orders';
 state:=public.pitacco_test_hours_at('d2000000-0000-0000-0000-000000000001','2026-11-22 13:00:00-03');
 assert state->>'open'='true','All-day Sunday schedule works';
 begin
  perform public.pitacco_store_hours_save('d2000000-0000-0000-0000-000000000001',
   '[{"weekday":1,"slot":1,"opens_minute":720,"closes_minute":900},
     {"weekday":1,"slot":2,"opens_minute":840,"closes_minute":960}]'::jsonb,false,1);
  raise exception 'Expected overlapping shift rejection';
 exception when raise_exception then
  if sqlerrm <> 'Há horários de funcionamento sobrepostos' then raise;end if;
 end;
 begin
  perform public.pitacco_store_hours_save('d2000000-0000-0000-0000-000000000001','[]'::jsonb,false,0);
  raise exception 'Old revision must fail';
 exception when raise_exception then
  if sqlerrm not like 'Horários alterados em outro dispositivo%' then raise;end if;
 end;
 begin
  perform public.pitacco_store_hours_state('d2000000-0000-0000-0000-000000000002');
  raise exception 'Cross-tenant read must fail';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_store_hours_save('d2000000-0000-0000-0000-000000000002','[]'::jsonb,false,0);
  raise exception 'Cross-tenant write must fail';
 exception when insufficient_privilege then null;end;

 select jsonb_agg(jsonb_build_object('weekday',d,'slot',1,'opens_minute',0,'closes_minute',1440))
  into windows from generate_series(1,7) d;
 perform public.pitacco_store_hours_save('d2000000-0000-0000-0000-000000000001',windows,false,1);
end $test$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare menu jsonb; key uuid:='d4000000-0000-0000-0000-000000000001'; result jsonb;
 payload jsonb:='[{"product_id":"d3000000-0000-0000-0000-000000000001","quantity":1}]';
begin
 menu:=public.get_public_menu('horarios-loja');
 assert menu->'store'->'opening_hours'->>'open'='true';
 assert public.pitacco_public_store_open('horarios-loja')->>'open'='true';
 result:=public.checkout_public_order('horarios-loja',key,'Cliente','21999999999','',payload,'pickup','dinheiro','');
 assert (result->>'total')::numeric=20;
 perform set_config('test.hours_order',result::text,true);
end $test$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
select public.pitacco_store_hours_save('d2000000-0000-0000-0000-000000000001',
 (select jsonb_agg(jsonb_build_object('weekday',d,'slot',1,'opens_minute',0,'closes_minute',1440))
  from generate_series(1,7) d),true,2);

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare key uuid:='d4000000-0000-0000-0000-000000000001';
 payload jsonb:='[{"product_id":"d3000000-0000-0000-0000-000000000001","quantity":1}]';
 result jsonb;
begin
 assert public.pitacco_public_store_open('horarios-loja')->>'open'='false';
 assert public.pitacco_public_store_open('horarios-loja')->>'reason'='paused';
 result:=public.checkout_public_order('horarios-loja',key,'Cliente','21999999999','',payload,'pickup','dinheiro','');
 assert result::text=current_setting('test.hours_order'),'Retry of an already completed order must survive closing';
 begin
  perform public.checkout_public_order('horarios-loja',gen_random_uuid(),'Cliente','21999999999','',payload,'pickup','dinheiro','');
  raise exception 'Expected closed-store checkout block';
 exception when raise_exception then
  if sqlerrm not like 'Loja fechada no momento%' then raise;end if;
 end;
 begin
  perform public.checkout_public_order_coupon('horarios-loja',gen_random_uuid(),'Cliente','21999999999','',payload,'pickup','dinheiro','','CODE');
  raise exception 'Expected coupon checkout closed-store block';
 exception when raise_exception then
  if sqlerrm not like 'Loja fechada no momento%' then raise;end if;
 end;
end $test$;
-- Opening-hours scheduling uses the same weekly periods; no separate appointment agenda.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
do $test$
declare s uuid:='d2000000-0000-0000-0000-000000000001'; tomorrow integer:=extract(isodow from ((now() at time zone 'America/Sao_Paulo')::date+1)); cfg jsonb;
begin
 cfg:=public.pitacco_store_hours_save_v2(s,jsonb_build_array(jsonb_build_object('weekday',tomorrow,'slot',1,'opens_minute',720,'closes_minute',840),jsonb_build_object('weekday',tomorrow,'slot',2,'opens_minute',1080,'closes_minute',1320)),false,3,true);
 assert cfg->'current'->>'scheduling_available'='true';
 assert cfg->'current'->>'open'='false';
end $test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare slots timestamptz[]:=public.pitacco_public_schedule_slots('horarios-loja','pickup'); result jsonb;
 payload jsonb:='[{"product_id":"d3000000-0000-0000-0000-000000000001","quantity":1}]';
begin
 assert cardinality(slots)>0;
 assert not exists(select 1 from unnest(slots) t where (t at time zone 'America/Sao_Paulo')::time not between time '12:00' and time '13:30' and (t at time zone 'America/Sao_Paulo')::time not between time '18:00' and time '21:30');
 result:=public.pitacco_checkout_scheduled_order('horarios-loja',gen_random_uuid(),'Cliente','21999999999','',payload,'pickup','dinheiro','',slots[1]);
 assert result->>'status'='pending','Closed shop accepts only valid scheduled orders';
 begin
  perform public.checkout_public_order('horarios-loja',gen_random_uuid(),'Cliente','21999999999','',payload,'pickup','dinheiro','');
  raise exception 'Expected immediate checkout rejection';
 exception when raise_exception then if sqlerrm not like 'Loja fechada no momento%' then raise;end if;end;
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
select public.pitacco_store_hours_save_v2('d2000000-0000-0000-0000-000000000001',public.pitacco_store_hours_state('d2000000-0000-0000-0000-000000000001')->'periods',true,4,true);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$ begin
 assert cardinality(public.pitacco_public_schedule_slots('horarios-loja','pickup'))=0;
 assert public.pitacco_public_store_open('horarios-loja')->>'scheduling_available'='false';
end $test$;
reset role;
do $test$
begin
 assert not has_table_privilege('anon','public.pitacco_store_hours','SELECT');
 assert not has_table_privilege('authenticated','public.pitacco_opening_periods','UPDATE');
 assert not has_function_privilege('anon','public.pitacco_store_hours_save(uuid,jsonb,boolean,integer)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_store_hours_state(uuid)','EXECUTE');
end $test$;
rollback;
