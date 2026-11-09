begin;
insert into auth.users(id,email) values('10000000-0000-0000-0000-000000000001','manager@example.invalid'),('10000000-0000-0000-0000-000000000002','courier@example.invalid'),('10000000-0000-0000-0000-000000000003','other@example.invalid');
insert into public.stores(id,name,dispatch_mode,max_orders_per_trip,latitude,longitude) values('20000000-0000-0000-0000-000000000001','Test','automatico',2,0,0);
insert into public.store_members values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','gestor');
insert into public.couriers(id,user_id,name,fleet_type,store_id) values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Test courier','propria','20000000-0000-0000-0000-000000000001');
insert into public.deliveries(id,store_id,customer_name,address,latitude,longitude,deliver_by) select ('40000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001','Test','Example',0,i/100.0,now()+interval '1 hour' from generate_series(1,4)i;
-- Trigger must not allocate without GPS/maps.
do $$begin assert not exists(select 1 from public.deliveries where courier_id is not null),'No unverified insert auto dispatch';end$$;
insert into public.deliveries(id,store_id,customer_name,address,source,logistics_provider) values('40000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','Partner','Example','ifood','marketplace');
set local role service_role;
do $$begin assert public.dispatch_candidates()='[]'::jsonb,'Offline excluded';end$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select public.set_courier_availability(true);
do $$begin
 begin perform public.courier_heartbeat(0,0,200);raise exception 'TEST FAILURE bad GPS';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
end$$;
reset role;
set local role service_role;
do $$begin assert public.dispatch_candidates()='[]'::jsonb,'No GPS excluded';end$$;
reset role;
set local role authenticated;
select public.courier_heartbeat(0,0,10);
-- Public client cannot claim validated routing evidence.
do $$begin
 begin perform public.dispatch_candidates();raise exception 'TEST FAILURE worker accessible';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role service_role;
do $$declare candidates jsonb; k uuid; r uuid;begin
 candidates:=public.dispatch_candidates();assert jsonb_array_length(candidates)=4,'Online candidates';
 k:=(candidates->0->>'token')::uuid;
 begin perform public.commit_auto_dispatch(k,'{"compatible":false}');raise exception 'TEST FAILURE map failure';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 r:=public.commit_auto_dispatch(k,'{"compatible":true,"method":"directed-road-matrix","provider":"fixture-only"}');
 assert r is not null,'Validated allocation';
 begin perform public.commit_auto_dispatch(k,'{"compatible":true,"method":"directed-road-matrix","provider":"fixture-only"}');raise exception 'TEST FAILURE replay';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 -- Other snapshots were created before the route changed, so must be rejected.
 k:=(candidates->1->>'token')::uuid;
 begin perform public.commit_auto_dispatch(k,'{"compatible":true,"method":"directed-road-matrix","provider":"fixture-only"}');raise exception 'TEST FAILURE stale route';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
end$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$declare r uuid;d uuid;other uuid;c uuid:='30000000-0000-0000-0000-000000000001';begin
 select id into d from public.deliveries where courier_id=c;
 select id into other from public.deliveries where status='pendente' and logistics_provider='loja' order by id limit 1;
 begin perform public.assign_order_courier('40000000-0000-0000-0000-000000000005',c,true);raise exception 'TEST FAILURE partner';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 begin perform public.assign_order_courier(other,c,false);raise exception 'TEST FAILURE missing deviation confirmation';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 r:=public.assign_order_courier(other,c,true);
 assert r=(select batch_id from public.deliveries where id=d),'Manual grouping same route';
 perform public.assign_order_courier(other,c,true);
 assert (select count(*)=2 from public.deliveries where batch_id=r),'Retry not duplicated';
 select id into other from public.deliveries where status='pendente' and logistics_provider='loja' order by id limit 1;
 begin perform public.assign_order_courier(other,c,true);raise exception 'TEST FAILURE capacity';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 assert exists(select 1 from public.operation_audit where action='route_manual_assigned' and actor=auth.uid() and details->>'deviation_confirmed'='true'),'Manual audit';
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
 begin perform public.assign_order_courier(other,c,true);raise exception 'TEST FAILURE unauthorized';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$declare x record;r uuid;begin
 select id into r from public.delivery_batches where completed_at is null;
 begin perform public.depart_route(r);raise exception 'TEST FAILURE depart without collect';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
 for x in select id from public.deliveries where batch_id=r loop perform public.set_delivery_status(x.id,'aceita');perform public.collect_delivery(x.id);end loop;
 perform public.depart_route(r);perform public.depart_route(r);
 assert (select count(*)=2 from public.deliveries where batch_id=r and status='retirada'),'Departure all stops';
 select id into x from public.deliveries where batch_id=r limit 1;
 perform public.set_delivery_status(x.id,'entregue');
 assert (select completed_at is null from public.delivery_batches where id=r),'Partial not free';
end$$;
reset role;
-- Increase cap to ensure departure, rather than capacity, is the reason for rejection.
update public.stores set max_orders_per_trip=4;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$declare d uuid;begin
 select id into d from public.deliveries where status='pendente' and logistics_provider='loja' limit 1;
 begin perform public.assign_order_courier(d,'30000000-0000-0000-0000-000000000001',true);raise exception 'TEST FAILURE departed append';exception when others then if SQLERRM like 'TEST FAILURE%' then raise;end if;end;
end$$;
reset role;
set local role service_role;
do $$begin assert public.dispatch_candidates()='[]'::jsonb,'Departed courier excluded';end$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$declare d uuid;begin select id into d from public.deliveries where status='retirada';perform public.set_delivery_status(d,'entregue');assert not exists(select 1 from public.delivery_batches where completed_at is null),'All stops resolved';end$$;
reset role;
set local role service_role;
do $$begin assert jsonb_array_length(public.dispatch_candidates())=2,'Eligible after all resolved';end$$;
reset role;
update public.courier_positions set observed_at=now()-interval '5 minutes';
set local role service_role;
do $$begin assert public.dispatch_candidates()='[]'::jsonb,'Stale GPS excluded';end$$;
rollback;
