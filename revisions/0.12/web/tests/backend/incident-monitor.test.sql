begin;
insert into auth.users(id,email) values
 ('81000000-0000-0000-0000-000000000001','incident-manager@example.invalid'),
 ('81000000-0000-0000-0000-000000000002','incident-owner@example.invalid');
insert into pitacco_private.platform_owner(user_id) values('81000000-0000-0000-0000-000000000002');
insert into public.stores(id,name) values
 ('82000000-0000-0000-0000-000000000001','Incidentes A'),
 ('82000000-0000-0000-0000-000000000002','Incidentes B');
insert into public.store_members values
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','gestor');
insert into public.orders(id,store_id,channel,gross,source,status,receipt,created_at)
values('83000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001',
 'Delivery próprio',25,'proprio','pending','{"display_number":"D-101"}',now()-interval '20 minutes');
do $test$ begin
 assert pitacco_private.collect_operational_incidents()>=1;
 assert (select count(*) from public.pitacco_operational_incidents
  where store_id='82000000-0000-0000-0000-000000000001'
    and code='acceptance_late' and status='open')=1;
 assert pitacco_private.collect_operational_incidents()>=1;
 assert (select detections>=2 from public.pitacco_operational_incidents
  where store_id='82000000-0000-0000-0000-000000000001' and code='acceptance_late');
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
do $test$
declare incident uuid;
begin
 assert jsonb_array_length(public.pitacco_incidents('82000000-0000-0000-0000-000000000001')->'rows')>=1;
 incident:=(public.pitacco_incidents('82000000-0000-0000-0000-000000000001')->'rows'->0->>'id')::uuid;
 begin
  perform public.pitacco_incidents('82000000-0000-0000-0000-000000000002');
  raise exception 'Foreign store access must be rejected';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_owner_acknowledge_incident(incident,'Recebido pelo lojista');
  raise exception 'Manager must not acknowledge incidents';
 exception when insufficient_privilege then null;end;
end $test$;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
do $test$
declare incident uuid; result jsonb;
begin
 incident:=(public.pitacco_incidents(null)->'rows'->0->>'id')::uuid;
 result:=public.pitacco_owner_acknowledge_incident(incident,'Incidente recebido e atribuído ao suporte');
 assert result->>'acknowledged'='true';
 assert (select acknowledged_at is not null from public.pitacco_operational_incidents where id=incident);
end $test$;
reset role;
update public.orders set status='accepted',preparation_status='ready',accepted_at=now()
 where id='83000000-0000-0000-0000-000000000001';
do $test$ begin
 perform pitacco_private.collect_operational_incidents();
 assert (select status='resolved' from public.pitacco_operational_incidents
 where store_id='82000000-0000-0000-0000-000000000001' and code='acceptance_late');
 assert not has_table_privilege('authenticated','public.pitacco_operational_incidents','UPDATE');
 assert not has_function_privilege('anon','public.pitacco_incidents(uuid,text,integer)','EXECUTE');
end $test$;
rollback;
