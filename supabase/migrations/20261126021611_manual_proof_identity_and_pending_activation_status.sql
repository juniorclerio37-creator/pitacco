
alter table pitacco_private.trial_identity_registry add column if not exists document_last4 text check(document_last4 ~ '^[0-9]{4}$');
do $patch$ declare f text; begin
 select pg_get_functiondef('public.pitacco_register_store(text,text)'::regprocedure) into f;
 if strpos(f,'first_trial_started_at)')=0 or strpos(f,'values(v_kind,v_hash,v_uid,v_store,now());')=0 then raise exception 'Registration anchor missing';end if;
 execute replace(replace(f,'first_trial_started_at)','first_trial_started_at,document_last4)'),'values(v_kind,v_hash,v_uid,v_store,now());','values(v_kind,v_hash,v_uid,v_store,now(),right(v_doc,4));');
end $patch$;
create or replace function pitacco_private.manual_invoice_reference(p_invoice uuid) returns text language sql stable set search_path='' as $$
 select 'pitacco:manual:'||p_invoice::text
$$;
revoke all on function pitacco_private.manual_invoice_reference(uuid) from public,anon,authenticated;
do $patch$ declare f text; begin
 select pg_get_functiondef('public.pitacco_submit_commercial_payment(uuid,text,text,text)'::regprocedure) into f;
 if strpos(f,'if length(btrim(coalesce(p_reference')=0 then raise exception 'Proof reference anchor missing';end if;
 execute replace(f,'if length(btrim(coalesce(p_reference','p_reference:=pitacco_private.manual_invoice_reference(i.id); if length(btrim(coalesce(p_reference');
 select pg_get_functiondef('public.pitacco_owner_review_commercial_payment(uuid,boolean,text)'::regprocedure) into f;
 if strpos(f,'if p_approve then')=0 then raise exception 'Review anchor missing';end if;
 execute replace(f,'if p_approve then','if p_approve and c.reference like ''pitacco:manual:%'' then raise exception ''Informe o identificador bancário do Pix na conferência'';end if; if p_approve then');
end $patch$;
create or replace function public.pitacco_owner_review_manual_proof(p_claim uuid,p_approve boolean,p_note text,p_bank_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare c pitacco_private.commercial_payment_claims%rowtype;i pitacco_private.commercial_invoices%rowtype;bank_ref text;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_approve is null or length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe a justificativa';end if;
 if not p_approve then perform public.pitacco_owner_review_commercial_payment(p_claim,false,p_note);return;end if;
 bank_ref:=upper(btrim(coalesce(p_bank_reference,'')));
 if bank_ref !~ '^E[0-9A-Z]{31}$' then raise exception 'Informe o identificador End-to-End do Pix (32 caracteres) conferido no banco';end if;
 select * into c from pitacco_private.commercial_payment_claims where id=p_claim;
 if not found then raise exception 'Comprovante indisponível';end if;
 select * into i from pitacco_private.commercial_invoices where id=c.invoice_id for update;
 select * into c from pitacco_private.commercial_payment_claims where id=p_claim for update;
 if c.status<>'pending' then raise exception 'Comprovante já analisado';end if;
 perform pg_advisory_xact_lock(hashtextextended('pitacco-payment-reference:'||bank_ref,0));
 if exists(select 1 from pitacco_private.commercial_manual_payments where upper(reference) in (bank_ref,'PIX:'||bank_ref)) or exists(select 1 from pitacco_private.asaas_commercial_resolutions where upper(recovery_reference) in (bank_ref,'PIX:'||bank_ref)) then raise exception 'Este Pix já foi utilizado';end if;
 if c.recovery_amount_cents is not null then perform pitacco_private.confirm_asaas_recovery(i.id,c.recovery_amount_cents,bank_ref,p_note,auth.uid());
 else perform public.pitacco_owner_confirm_commercial_payment(i.id,i.amount_cents,bank_ref,p_note);end if;
 update pitacco_private.commercial_payment_claims set status='approved',reviewed_at=now(),reviewed_by=auth.uid(),review_note=btrim(p_note) where id=c.id;
end $$;
revoke all on function public.pitacco_owner_review_manual_proof(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_owner_review_manual_proof(uuid,boolean,text,text) to authenticated;
do $patch$ declare f text; fields text; begin
 fields:=$fields$,(select cc.plan_code from pitacco_private.commercial_contracts cc where cc.id=i.contract_id) as plan_code,(select case when t.document_last4 is not null then upper(t.identity_kind)||' final '||t.document_last4 else upper(t.identity_kind)||' cadastrado (número indisponível)' end from pitacco_private.trial_identity_registry t where t.first_store_id=b.store_id limit 1) as fiscal_identity,exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=i.contract_id and fp.activated_at is null and not fp.first_trial_grace) as activation_pending$fields$;
 select pg_get_functiondef('public.pitacco_commercial_invoices(uuid,integer)'::regprocedure) into f;
 if strpos(f,'s.name as store_name,i.kind')=0 then raise exception 'Invoice listing anchor missing';end if;
 f:=replace(f,'s.name as store_name,i.kind','s.name as store_name,i.kind'||fields);
 f:=replace(f,'else pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until) end as status','when p.invoice_id is null and b.state=''calculated'' and b.amount_cents=i.amount_cents and exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=i.contract_id and fp.activated_at is null and not fp.first_trial_grace) then ''open'' else pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until) end as status');
 execute f;
 select pg_get_functiondef('public.pitacco_owner_commercial_payment_claims(uuid,text,integer)'::regprocedure) into f;
 if strpos(f,'s.name as store_name,i.kind')=0 then raise exception 'Claim listing anchor missing';end if;
 execute replace(f,'s.name as store_name,i.kind','s.name as store_name,i.kind,b.period_start,i.period_end'||fields);
end $patch$;
notify pgrst,'reload schema';

