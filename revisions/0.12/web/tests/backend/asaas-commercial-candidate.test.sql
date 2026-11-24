-- Isolated transaction only. Provider callbacks below are simulated as service_role;
-- no external requests, money, or actual store records.
reset role;
insert into public.stores(id,name) values('21000000-0000-0000-0000-000000000001','Asaas fixture');
insert into public.store_members values('21000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','gestor');
insert into pitacco_private.commercial_contracts(id,store_id,revision,plan_code,effective_from,terms,assigned_by)
select '22000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',revision,'free',current_date-7,plans->0,'10000000-0000-0000-0000-000000000001'
from pitacco_private.plan_catalog_versions where revision='2026-11-24-v1';
insert into pitacco_private.commercial_closings(contract_id,store_id,kind,period_start,period_end,due_at,grace_until,amount_cents,state,details)
values('22000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','commission',current_date-7,current_date,now()+interval '2 hours',now()+interval '50 hours',1749,'calculated','{}');
insert into pitacco_private.commercial_invoices(id,contract_id,kind,period_end,amount_cents,due_at,grace_until)
values('23000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','commission',current_date,1749,now()+interval '2 hours',now()+interval '50 hours');
-- Unknown or unauthorized users cannot retrieve payment context or mutate reconciliation.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ begin
 begin perform public.pitacco_commercial_asaas_payment_context('23000000-0000-0000-0000-000000000001');raise exception 'Cross-store payment context accepted';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_reserve_commercial_asaas_issue('23000000-0000-0000-0000-000000000001','production','PIX');raise exception 'Unauthorized issue';exception when insufficient_privilege then null;end;
 begin perform public.pitacco_owner_asaas_enrollment_access('21000000-0000-0000-0000-000000000001');raise exception 'Unauthorized enrollment';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ begin
 assert public.pitacco_reserve_asaas_customer('21000000-0000-0000-0000-000000000001')='reserved';
 assert public.pitacco_reserve_asaas_customer('21000000-0000-0000-0000-000000000001')='recover_only';
 assert public.pitacco_finalize_asaas_customer('21000000-0000-0000-0000-000000000001','cus_fixture')='linked';
 assert public.pitacco_finalize_asaas_customer('21000000-0000-0000-0000-000000000001','cus_fixture')='already_linked';
 assert public.pitacco_reserve_commercial_asaas_issue('23000000-0000-0000-0000-000000000001','production','PIX')->>'outcome'='unavailable';
 assert public.pitacco_link_commercial_asaas_charge('23000000-0000-0000-0000-000000000001','production','pay_fixture','cus_fixture',1749)='invalid_reservation';
end $$;
reset role;
update pitacco_private.commercial_billing_control set asaas_enabled=true where singleton;
set local role service_role;
do $$ begin
 assert public.pitacco_reserve_commercial_asaas_issue('23000000-0000-0000-0000-000000000001','production','PIX')->>'outcome'='reserved';
 assert public.pitacco_reserve_commercial_asaas_issue('23000000-0000-0000-0000-000000000001','production','BOLETO')->>'outcome'='recover_only';
 assert public.pitacco_link_commercial_asaas_charge('23000000-0000-0000-0000-000000000001','production','pay_fixture','cus_fixture',1749)='linked';
 assert public.pitacco_link_commercial_asaas_charge('23000000-0000-0000-0000-000000000001','production','pay_fixture','cus_fixture',1749)='already_linked';
 assert public.pitacco_reconcile_commercial_asaas_charge('production','pay_unknown','cus_fixture','pitacco:commercial:23000000-0000-0000-0000-000000000001',1749,'RECEIVED')='unlinked';
end $$;
reset role;
update pitacco_private.commercial_invoices set due_at=now()-interval '72 hours',grace_until=now()-interval '24 hours' where id='23000000-0000-0000-0000-000000000001';
do $$ begin assert pitacco_private.commercial_orders_blocked('21000000-0000-0000-0000-000000000001');end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
 begin perform public.pitacco_owner_confirm_commercial_payment('23000000-0000-0000-0000-000000000001',1749,'manual-conflict','Conferência de teste');raise exception 'Duplicate manual settlement accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
set local role service_role;
do $$ begin
 assert public.pitacco_reconcile_commercial_asaas_charge('production','pay_fixture','cus_fixture','pitacco:commercial:23000000-0000-0000-0000-000000000001',1749,'CONFIRMED')='confirmed';
 assert public.pitacco_reconcile_commercial_asaas_charge('production','pay_fixture','cus_fixture','pitacco:commercial:23000000-0000-0000-0000-000000000001',1749,'RECEIVED')='received';
 assert public.pitacco_reconcile_commercial_asaas_charge('production','pay_fixture','cus_fixture','pitacco:commercial:23000000-0000-0000-0000-000000000001',1749,'RECEIVED')='received';
end $$;
reset role;
do $$ begin assert not pitacco_private.commercial_orders_blocked('21000000-0000-0000-0000-000000000001');end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ declare r jsonb; begin
 r:=public.pitacco_commercial_invoices('21000000-0000-0000-0000-000000000001');
 assert r#>>'{rows,0,status}'='paid' and r#>>'{rows,0,asaas_status}'='received';
 assert public.pitacco_store_commercial_block_status('21000000-0000-0000-0000-000000000001')->>'orders_blocked'='false';
end $$;
reset role;
set local role service_role;
do $$ begin
 assert public.pitacco_reconcile_commercial_asaas_charge('production','pay_fixture','cus_fixture','pitacco:commercial:23000000-0000-0000-0000-000000000001',1749,'REFUNDED')='review_required';
 assert public.pitacco_reconcile_commercial_asaas_charge('production','pay_fixture','cus_fixture','pitacco:commercial:23000000-0000-0000-0000-000000000001',1749,'RECEIVED')='review_required';
end $$;
reset role;
do $$ begin assert pitacco_private.commercial_orders_blocked('21000000-0000-0000-0000-000000000001');end $$;
