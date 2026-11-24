
-- The same status feeds the merchant banner, regardless of the order channel.
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_store_commercial_block_status(uuid)'::regprocedure) into d;
 a:='and p.invoice_id is null and b.state=''calculated'' and b.amount_cents=i.amount_cents';
 if position(a in d)=0 then raise exception 'Notice query changed';end if;
 d:=replace(d,a,$new$
 and p.invoice_id is null and b.state='calculated' and b.amount_cents=i.amount_cents
 and (not exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) or pitacco_private.asaas_current_resolution(i.id)='manual_only')
 union all
 select ar.decided_at,ar.due_at,case when now()>=ar.due_at then 'overdue' else 'grace' end,
 exists(select 1 from pitacco_private.commercial_payment_claims claim where claim.invoice_id=ar.invoice_id and claim.status='pending')
 from pitacco_private.asaas_commercial_resolutions ar join pitacco_private.commercial_invoices i on i.id=ar.invoice_id
 join pitacco_private.commercial_contracts c on c.id=i.contract_id
 where c.store_id=p_store and ar.decision='recovery_due' and ar.evidence=pitacco_private.asaas_incident_evidence(i.id)
 $new$);
 execute d;
end $patch$;
-- Prevent a recovered reference from being reused through other settlement paths.
create function pitacco_private.guard_commercial_payment_reference()
returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('pitacco-payment-reference:'||new.reference,0));
 if exists(select 1 from pitacco_private.asaas_commercial_resolutions where recovery_reference=new.reference) then raise exception 'Referência já utilizada na recuperação financeira';end if;
 return new;
end $$;
revoke all on function pitacco_private.guard_commercial_payment_reference() from public,anon,authenticated;
create trigger guard_commercial_payment_reference before insert on pitacco_private.commercial_manual_payments for each row execute function pitacco_private.guard_commercial_payment_reference();

