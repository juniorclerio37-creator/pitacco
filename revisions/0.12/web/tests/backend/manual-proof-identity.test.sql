begin;
do $test$
declare u uuid:=gen_random_uuid(); s uuid; c uuid; i uuid; claim uuid; rev text; offer jsonb; v jsonb;
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid');
 insert into public.stores(name) values('Fixture manual proof') returning id into s;
 insert into public.store_members(store_id,user_id,role) values(s,u,'gestor');
 select revision into rev from public.pitacco_plan_catalog_signal where singleton;
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision=rev and x->>'code'='complete';
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(s,rev,'complete',current_date,offer,u) returning id into c;
 insert into pitacco_private.fixo_prepaid_state(contract_id,first_due_at) values(c,now()-interval '1 day');
 i:=pitacco_private.ensure_fixo_prepaid_invoice(c);
 update pitacco_private.commercial_billing_control set pix_cnpj='00000000000000',pix_recipient='Fixture' where singleton;
 perform set_config('request.jwt.claim.sub',u::text,true);
 v:=public.pitacco_commercial_invoices(s,0);
 assert v#>>'{rows,0,status}'='open';
 assert v#>>'{rows,0,activation_pending}'='true';
 assert v#>>'{rows,0,plan_code}'='complete';
 claim:=public.pitacco_submit_commercial_payment(i,'ATTEMPT-TO-CHANGE','application/pdf',encode(convert_to('%PDF-TEST','UTF8'),'base64'));
 assert (select reference='pitacco:manual:'||i::text from pitacco_private.commercial_payment_claims where id=claim);
 begin perform public.pitacco_owner_review_manual_proof(claim,true,'Fixture note','E'||repeat('1',31));raise exception 'TEST unauthorized';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('anon','public.pitacco_owner_review_manual_proof(uuid,boolean,text,text)','execute');
end $test$;
rollback;