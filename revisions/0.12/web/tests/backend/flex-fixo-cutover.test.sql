begin;
do $test$
declare u uuid:=gen_random_uuid(); s uuid; c uuid; nc uuid; i uuid; wed date; cutoff timestamptz; offer jsonb; pending_id uuid;
begin
 insert into public.stores(name) values('VALIDACAO MIGRACAO TEMPORARIA') returning id into s;
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision='2026-11-24-v3' and x->>'code'='free';
 wed:=(now() at time zone 'America/Sao_Paulo')::date-((extract(isodow from now() at time zone 'America/Sao_Paulo')::int-3+7)%7);
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(s,'2026-11-24-v3','free',wed-7,offer,u) returning id into c;
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision='2026-11-24-v3' and x->>'code'='complete';
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(s,'2026-11-24-v3','complete',(now() at time zone 'America/Sao_Paulo')::date,offer||jsonb_build_object('trial_days',0,'prepaid',true),u) returning id into nc;
 insert into pitacco_private.fixo_prepaid_state(contract_id,first_due_at,previous_flex_contract) values(nc,now(),c);
 i:=pitacco_private.ensure_fixo_prepaid_invoice(nc);
 assert i is not null,'migration invoice issued';
 assert (select valid_until_at is null from pitacco_private.commercial_contracts where id=c),'flex continues before payment';
 insert into pitacco_private.commercial_manual_payments(invoice_id,amount_cents,reference,verified_by,note) values(i,5990,'TEST-'||gen_random_uuid(),u,'Teste migração');
 assert (select valid_until_at=now() from pitacco_private.commercial_contracts where id=c),'exact cutover';
 assert (select paid_until>now() from pitacco_private.fixo_prepaid_state where contract_id=nc),'coverage activated';
 cutoff:=(wed-2+time '12:00') at time zone 'America/Sao_Paulo';
 update pitacco_private.commercial_contracts set valid_until_at=cutoff where id=c;
 insert into public.orders(store_id,channel,gross,status,source,preparation_status,created_at,receipt) values
 (s,'Delivery próprio',100,'accepted','proprio','completed',cutoff-interval '1 second','{"subtotal":100,"discount":10}'),
 (s,'Delivery próprio',100,'accepted','proprio','completed',cutoff,'{"subtotal":100,"discount":0}'),
 (s,'Delivery próprio',100,'accepted','proprio','completed',cutoff+interval '1 second','{"subtotal":100,"discount":0}'),
 (s,'iFood',100,'accepted','ifood','completed',cutoff-interval '1 second','{"subtotal":100,"discount":0}');
 insert into public.orders(store_id,channel,gross,status,source,preparation_status,created_at,receipt) values
 (s,'Delivery próprio',100,'pending','proprio','completed',cutoff-interval '2 seconds','{"subtotal":100,"discount":0}') returning id into pending_id;
 perform pitacco_private.run_commercial_billing();
 assert (select state='review_required' from pitacco_private.commercial_closings where contract_id=c and period_end=wed),'pending requires review';
 assert not exists(select 1 from pitacco_private.commercial_invoices where contract_id=c),'no premature invoice';
 update public.orders set status='cancelled' where id=pending_id;
 perform pitacco_private.run_commercial_billing();
 assert (select amount_cents=450 from pitacco_private.commercial_invoices where contract_id=c and kind='commission' and period_end=wed),'only pre-payment eligible orders';
 perform pitacco_private.run_commercial_billing();
 assert (select count(*)=1 from pitacco_private.commercial_invoices where contract_id=c),'no duplicate historical commission';
end $test$;
rollback;
