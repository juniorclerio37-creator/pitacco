begin;
insert into auth.users(id,email) values
 ('81000000-0000-0000-0000-000000000001','incident-manager@example.invalid'),
 ('81000000-0000-0000-0000-000000000002','incident-owner@example.invalid');
insert into pitacco_private.platform_owner(user_id) values('81000000-0000-0000-0000-000000000002');
insert into public.stores(id,name) values
 ('82000000-0000-0000-0000-000000000001','Incidentes A'),
 ('82000000-0000-0000-0000-000000000002','Incidentes B');
-- Sound corrections may only change an existing, disabled store setting.
insert into public.pitacco_store_sound_settings(store_id,enabled,volume)
values ('82000000-0000-0000-0000-000000000001',false,72),
       ('82000000-0000-0000-0000-000000000002',false,64);
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
-- Explicit payment failures are captured by a trigger, without waiting for cron.
update public.orders set receipt='{"display_number":"D-101","payment_status":"failed"}'::jsonb
 where id='83000000-0000-0000-0000-000000000001';
do $test$ begin
 assert exists(
  select 1 from public.pitacco_operational_incidents
  where code='payment_failed' and entity_id='83000000-0000-0000-0000-000000000001'
   and status='open'
 );
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
do $test$
declare incident uuid;
begin
 begin
  perform public.pitacco_incidents('82000000-0000-0000-0000-000000000001');
  raise exception 'Managers must not read technical diagnostics';
 exception when insufficient_privilege then null;end;
 incident:='83000000-0000-0000-0000-000000000001';
 begin
  perform public.pitacco_owner_incident_pulse();
  raise exception 'Managers must not read global notification pulse';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_owner_diagnostic_snapshot();
  raise exception 'Managers must not read global technical telemetry';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_owner_repairs();
  raise exception 'Store managers must not inspect owner repair proposals';
 exception when insufficient_privilege then null;end;
 begin
  perform public.pitacco_owner_repair_propose('82000000-0000-0000-0000-000000000001');
  raise exception 'Store managers must not propose owner repairs';
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
 assert (public.pitacco_owner_incident_pulse()->>'open')::integer>=1;
 assert (public.pitacco_owner_incident_pulse()->>'urgent')::integer>=1;
 result:=public.pitacco_owner_diagnostic_snapshot('82000000-0000-0000-0000-000000000001');
 assert result->>'scope'='selected_store';
 assert (result->'printing'->>'jobs_24h')::integer>=0;
 assert (result->'courier_notifications') ? 'server_enabled';
 assert (result->'ifood') ? 'late_over_10m';
 assert (result->'marketplace_acceptance') ? '99food_rejected_24h';
 assert not (result ? 'token');
 result:=public.pitacco_owner_acknowledge_incident(incident,'Incidente recebido e atribuído ao suporte');
 assert result->>'acknowledged'='true';
 assert (public.pitacco_incidents(null)->'rows'->0->>'acknowledged_at') is not null;
end $test$;
-- Approval, auditing and rollback: owner alone, without touching orders or couriers.
do $repair$
declare proposed uuid; result jsonb; stale uuid;
begin
 result:=public.pitacco_owner_repairs('82000000-0000-0000-0000-000000000001');
 assert result->>'eligible'='true';
 assert (result->'selected_sound'->>'enabled')::boolean=false;

 proposed:=(public.pitacco_owner_repair_propose(
  '82000000-0000-0000-0000-000000000001')->>'id')::uuid;
 result:=public.pitacco_owner_repairs('82000000-0000-0000-0000-000000000001');
 assert result->>'eligible'='false';
 assert (result->'rows'->0->>'status')='proposed';
 assert (result->'selected_sound'->>'enabled')='false';

 result:=public.pitacco_owner_repair_decide(proposed,'apply');
 assert result->>'status'='applied';
 result:=public.pitacco_owner_repairs('82000000-0000-0000-0000-000000000001');
 assert (result->'selected_sound'->>'enabled')='true';
 assert (result->'selected_sound'->>'volume')='72';

 result:=public.pitacco_owner_repair_decide(proposed,'revert');
 assert result->>'status'='reverted';
 result:=public.pitacco_owner_repairs('82000000-0000-0000-0000-000000000001');
 assert (result->'selected_sound'->>'enabled')='false';
 assert (result->'selected_sound'->>'volume')='72';

 perform set_config('pitacco.test.applied_proposal',proposed::text,true);
 stale:=(public.pitacco_owner_repair_propose(
  '82000000-0000-0000-0000-000000000002')->>'id')::uuid;
 perform set_config('pitacco.test.stale_proposal',stale::text,true);
end $repair$;
reset role;
-- Testing private audit and a store change outside a privileged owner RPC.
do $audit$ begin
 assert (select count(*)=3 from pitacco_private.intelligence_repair_audit
  where proposal_id=current_setting('pitacco.test.applied_proposal')::uuid);
 update public.pitacco_store_sound_settings
 set volume=55, updated_at=clock_timestamp()
 where store_id='82000000-0000-0000-0000-000000000002';
end $audit$;
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000002',true);
do $stale$
declare stale uuid:=current_setting('pitacco.test.stale_proposal')::uuid; result jsonb;
begin
 begin
  perform public.pitacco_owner_repair_decide(stale,'apply');
  raise exception 'Stale settings must block application';
 exception when raise_exception then
  assert (public.pitacco_owner_repairs('82000000-0000-0000-0000-000000000002')
    ->'rows'->0->>'status')='proposed';
 end;
 result:=public.pitacco_owner_repair_decide(stale,'reject');
 assert result->>'status'='rejected';
end $stale$;
reset role;
update public.orders set status='accepted',preparation_status='ready',accepted_at=now()
 where id='83000000-0000-0000-0000-000000000001';
do $test$ begin
 perform pitacco_private.collect_operational_incidents();
 assert (select status='resolved' from public.pitacco_operational_incidents
 where store_id='82000000-0000-0000-0000-000000000001' and code='acceptance_late');
 assert not has_table_privilege('authenticated','public.pitacco_operational_incidents','UPDATE');
 assert not has_function_privilege('anon','public.pitacco_incidents(uuid,text,integer)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_owner_diagnostic_snapshot(uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_owner_repairs(uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_owner_repair_propose(uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_owner_repair_decide(uuid,text)','EXECUTE');
 assert not has_table_privilege('authenticated','pitacco_private.intelligence_repair_proposals','SELECT');
end $test$;
rollback;
