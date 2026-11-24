
create table pitacco_private.asaas_commercial_resolutions(
 invoice_id uuid primary key references pitacco_private.commercial_invoices(id),
 evidence jsonb not null,
 decision text not null check(decision in ('funds_confirmed','waived','manual_only','recovery_due','recovery_paid')),
 amount_cents bigint not null default 0 check(amount_cents>=0),
 due_at timestamptz,
 decided_at timestamptz not null default now(),
 decided_by uuid not null,
 note text not null check(length(note) between 5 and 500),
 recovery_reference text unique,
 recovery_paid_at timestamptz,
 check((decision in ('recovery_due','recovery_paid') and amount_cents>0 and due_at is not null) or (decision not in ('recovery_due','recovery_paid') and amount_cents=0 and due_at is null)),
 check((decision='recovery_paid' and recovery_reference is not null and recovery_paid_at is not null) or (decision<>'recovery_paid' and recovery_reference is null and recovery_paid_at is null))
);
alter table pitacco_private.asaas_commercial_resolutions enable row level security;
revoke all on pitacco_private.asaas_commercial_resolutions from public,anon,authenticated;
alter table pitacco_private.commercial_payment_claims add column recovery_amount_cents bigint check(recovery_amount_cents>0);
create function pitacco_private.asaas_incident_evidence(p_invoice uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_object_agg(event_type,provider_status) from pitacco_private.asaas_commercial_incidents where invoice_id=p_invoice
$$;
create function pitacco_private.asaas_current_resolution(p_invoice uuid)
returns text language sql stable set search_path='' as $$
 select decision from pitacco_private.asaas_commercial_resolutions where invoice_id=p_invoice and evidence=pitacco_private.asaas_incident_evidence(p_invoice)
$$;
create function pitacco_private.resolve_asaas_incident(p_invoice uuid,p_decision text,p_amount_cents bigint,p_note text,p_actor uuid)
returns void language plpgsql set search_path='' as $$
declare i pitacco_private.commercial_invoices%rowtype; evidence_now jsonb; prior pitacco_private.asaas_commercial_resolutions%rowtype; paid boolean; s uuid; due timestamptz;
begin
 if p_actor is null or p_decision is null or p_decision not in ('funds_confirmed','waived','manual_only','recovery_due') or length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe uma decisão e justificativa válidas';end if;
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found then raise exception 'Fatura indisponível';end if;
 evidence_now:=pitacco_private.asaas_incident_evidence(i.id);
 if evidence_now is null then raise exception 'Não há ocorrência Asaas';end if;
 select * into prior from pitacco_private.asaas_commercial_resolutions where invoice_id=i.id for update;
 if prior.decision='recovery_paid' then raise exception 'A recuperação já foi confirmada; nova ocorrência exige análise separada';end if;
 if exists(select 1 from pitacco_private.commercial_payment_claims where invoice_id=i.id and status='pending') then raise exception 'Analise o comprovante pendente primeiro';end if;
 select exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) into paid;
 if p_decision='manual_only' then
  if paid or not (evidence_now ? 'PAYMENT_DELETED') then raise exception 'A liberação para Pix manual exige cobrança excluída e não liquidada';end if;
  if not exists(select 1 from pitacco_private.commercial_billing_control where pix_cnpj is not null and pix_recipient is not null) then raise exception 'Configure o Pix manual antes da liberação';end if;
 elsif not paid then raise exception 'A fatura não possui pagamento original confirmado';end if;
 if p_decision='recovery_due' then
  if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>i.amount_cents then raise exception 'Saldo estornado inválido';end if;
  if not exists(select 1 from pitacco_private.commercial_billing_control where pix_cnpj is not null and pix_recipient is not null) then raise exception 'Configure o Pix manual antes de exigir a recuperação';end if;
  due:=case when prior.decision='recovery_due' then prior.due_at else now()+interval '48 hours' end;
 else
  p_amount_cents:=0;
 end if;
 insert into pitacco_private.asaas_commercial_resolutions(invoice_id,evidence,decision,amount_cents,due_at,decided_by,note)
 values(i.id,evidence_now,p_decision,p_amount_cents,due,p_actor,btrim(p_note))
 on conflict(invoice_id) do update set evidence=excluded.evidence,decision=excluded.decision,amount_cents=excluded.amount_cents,due_at=excluded.due_at,decided_by=excluded.decided_by,decided_at=now(),note=excluded.note;
 select store_id into s from pitacco_private.commercial_contracts where id=i.contract_id;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(s,p_actor,'asaas_incident_resolved',jsonb_build_object('invoice_id',i.id,'decision',p_decision,'amount_cents',p_amount_cents,'due_at',due,'evidence',evidence_now,'reason',btrim(p_note)));
end $$;
create function public.pitacco_owner_resolve_asaas_incident(p_invoice uuid,p_decision text,p_amount_cents bigint,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 perform pitacco_private.resolve_asaas_incident(p_invoice,p_decision,p_amount_cents,p_note,auth.uid());
end $$;
create function pitacco_private.confirm_asaas_recovery(p_invoice uuid,p_amount_cents bigint,p_reference text,p_note text,p_actor uuid)
returns void language plpgsql set search_path='' as $$
declare r pitacco_private.asaas_commercial_resolutions%rowtype; s uuid;
begin
 perform 1 from pitacco_private.commercial_invoices where id=p_invoice for update;
 select * into r from pitacco_private.asaas_commercial_resolutions where invoice_id=p_invoice for update;
 if not found or r.decision<>'recovery_due' or r.evidence is distinct from pitacco_private.asaas_incident_evidence(p_invoice) or r.amount_cents is distinct from p_amount_cents then raise exception 'Saldo de recuperação alterado; confira a ocorrência';end if;
 if p_actor is null or length(btrim(coalesce(p_reference,''))) not between 5 and 160 or length(btrim(coalesce(p_note,''))) not between 5 and 500 or exists(select 1 from pitacco_private.commercial_manual_payments where reference=btrim(p_reference)) then raise exception 'Referência ou justificativa inválida ou já utilizada';end if;
 perform pg_advisory_xact_lock(hashtextextended('pitacco-payment-reference:'||btrim(p_reference),0));
 if exists(select 1 from pitacco_private.commercial_manual_payments where reference=btrim(p_reference)) then raise exception 'Referência já utilizada';end if;
 update pitacco_private.asaas_commercial_resolutions set decision='recovery_paid',recovery_reference=btrim(p_reference),recovery_paid_at=now(),decided_by=p_actor,decided_at=now(),note=btrim(p_note) where invoice_id=p_invoice;
 select c.store_id into s from pitacco_private.commercial_invoices i join pitacco_private.commercial_contracts c on c.id=i.contract_id where i.id=p_invoice;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(s,p_actor,'asaas_recovery_confirmed',jsonb_build_object('invoice_id',p_invoice,'amount_cents',p_amount_cents,'reference',btrim(p_reference),'reason',btrim(p_note)));
end $$;
revoke all on function pitacco_private.asaas_incident_evidence(uuid),pitacco_private.asaas_current_resolution(uuid),pitacco_private.resolve_asaas_incident(uuid,text,bigint,text,uuid),pitacco_private.confirm_asaas_recovery(uuid,bigint,text,text,uuid) from public,anon,authenticated;
revoke all on function public.pitacco_owner_resolve_asaas_incident(uuid,text,bigint,text) from public,anon;
grant execute on function public.pitacco_owner_resolve_asaas_incident(uuid,text,bigint,text) to authenticated;
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_submit_commercial_payment(uuid,text,text,text)'::regprocedure) into d;
 d:=replace(d,'data bytea;result uuid;','data bytea;result uuid; recovery bigint; resolution text;');
 a:='if exists(select 1 from pitacco_private.asaas_commercial_charges where invoice_id=i.id) then';
 if position(a in d)=0 then raise exception 'Submit function changed';end if;
 d:=replace(d,a,'resolution:=pitacco_private.asaas_current_resolution(i.id); if resolution=''recovery_due'' then select amount_cents into recovery from pitacco_private.asaas_commercial_resolutions where invoice_id=i.id;end if; if exists(select 1 from pitacco_private.asaas_commercial_charges where invoice_id=i.id) and coalesce(resolution,'''') not in (''manual_only'',''recovery_due'') then');
 d:=replace(d,'if b.state<>''calculated'' or i.amount_cents is distinct from b.amount_cents or exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) then','if recovery is null and (b.state<>''calculated'' or i.amount_cents is distinct from b.amount_cents or exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id)) then');
 d:=replace(d,'(invoice_id,submitted_by,reference,mime,proof)','(invoice_id,submitted_by,reference,mime,proof,recovery_amount_cents)');
 d:=replace(d,'btrim(p_reference),p_mime,data) returning','btrim(p_reference),p_mime,data,recovery) returning');
 execute d;
 select pg_get_functiondef('public.pitacco_owner_confirm_commercial_payment(uuid,bigint,text,text)'::regprocedure) into d;
 a:='if exists(select 1 from pitacco_private.asaas_commercial_charges where invoice_id=i.id) then';
 if position(a in d)=0 then raise exception 'Confirm function changed';end if;
 d:=replace(d,a,'perform pg_advisory_xact_lock(hashtextextended(''pitacco-payment-reference:''||btrim(p_reference),0)); if exists(select 1 from pitacco_private.asaas_commercial_resolutions where recovery_reference=btrim(p_reference)) then raise exception ''Referência já utilizada'';end if; if exists(select 1 from pitacco_private.asaas_commercial_charges where invoice_id=i.id) and pitacco_private.asaas_current_resolution(i.id) is distinct from ''manual_only'' then');
 execute d;
 select pg_get_functiondef('public.pitacco_owner_review_commercial_payment(uuid,boolean,text)'::regprocedure) into d;
 a:='if p_approve then perform public.pitacco_owner_confirm_commercial_payment(i.id,i.amount_cents,c.reference,p_note);end if;';
 if position(a in d)=0 then raise exception 'Review function changed';end if;
 d:=replace(d,a,'if p_approve then if c.recovery_amount_cents is not null then perform pitacco_private.confirm_asaas_recovery(i.id,c.recovery_amount_cents,c.reference,p_note,auth.uid());else perform public.pitacco_owner_confirm_commercial_payment(i.id,i.amount_cents,c.reference,p_note);end if;end if;');
 execute d;
 select pg_get_functiondef('public.pitacco_owner_commercial_payment_claims(uuid,text,integer)'::regprocedure) into d;
 d:=replace(d,'i.kind,i.amount_cents,i.due_at,c.reference','i.kind,coalesce(c.recovery_amount_cents,i.amount_cents) as amount_cents,c.recovery_amount_cents,i.due_at,c.reference');
 execute d;
 select pg_get_functiondef('public.pitacco_commercial_invoices(uuid,integer)'::regprocedure) into d;
 a:='case when exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) then ''review_required'' else';
 if position(a in d)=0 then raise exception 'Invoice status changed';end if;
 d:=replace(d,a,$new$case when pitacco_private.asaas_current_resolution(i.id)='recovery_due' then 'recovery_due'
 when pitacco_private.asaas_current_resolution(i.id)='recovery_paid' then 'recovery_paid'
 when pitacco_private.asaas_current_resolution(i.id)='waived' then 'waived'
 when exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) and pitacco_private.asaas_current_resolution(i.id) is null then 'review_required' else$new$);
 d:=replace(d,'p.verified_at as paid_at,','pitacco_private.asaas_current_resolution(i.id) as asaas_resolution,(select amount_cents from pitacco_private.asaas_commercial_resolutions ar where ar.invoice_id=i.id and ar.decision in (''recovery_due'',''recovery_paid'')) as recovery_amount_cents,(select due_at from pitacco_private.asaas_commercial_resolutions ar where ar.invoice_id=i.id) as recovery_due_at,p.verified_at as paid_at,');
 execute d;
 select pg_get_functiondef('pitacco_private.commercial_orders_blocked(uuid)'::regprocedure) into d;
 a:='and (exists(select 1 from pitacco_private.fixo_prepaid_state';
 if position(a in d)=0 then raise exception 'Block guard changed';end if;
 d:=replace(d,a,$new$and (exists(select 1 from pitacco_private.asaas_commercial_resolutions ar join pitacco_private.commercial_invoices i on i.id=ar.invoice_id join pitacco_private.commercial_contracts c on c.id=i.contract_id where c.store_id=p_store and ar.decision='recovery_due' and ar.evidence=pitacco_private.asaas_incident_evidence(i.id) and now()>=ar.due_at) or exists(select 1 from pitacco_private.fixo_prepaid_state$new$);
 -- An unresolved provider incident must not cause a new automatic overdue block.
 d:=replace(d,'where b.store_id=p_store and not exists','where b.store_id=p_store and (not exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) or pitacco_private.asaas_current_resolution(i.id)=''manual_only'') and not exists');
 execute d;
end $patch$;

