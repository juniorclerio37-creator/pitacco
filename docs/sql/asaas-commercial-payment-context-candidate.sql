-- Candidate, after reconciliation/issuance/readside. No production activation.
-- The merchant's JWT is used for invoice ownership; the backend alone reserves/links charges.
create function public.pitacco_commercial_asaas_payment_context(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i pitacco_private.commercial_invoices%rowtype; b pitacco_private.commercial_closings%rowtype;
 a pitacco_private.commercial_asaas_charges%rowtype; intent pitacco_private.commercial_asaas_issue_intents%rowtype;
begin
 if auth.uid() is null then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into i from pitacco_private.commercial_invoices where id=p_invoice;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end;
 if b.store_id is null or not (public.pitacco_is_platform_owner() or public.is_store_manager(b.store_id)) then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into a from pitacco_private.commercial_asaas_charges where invoice_id=i.id and environment='production';
 select * into intent from pitacco_private.commercial_asaas_issue_intents where invoice_id=i.id and environment='production';
 return jsonb_build_object('invoice_id',i.id,'amount_cents',i.amount_cents,
 'available',exists(select 1 from pitacco_private.commercial_billing_control where singleton and asaas_enabled) and b.state='calculated' and b.amount_cents=i.amount_cents and not exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) and not exists(select 1 from pitacco_private.commercial_payment_claims where invoice_id=i.id and status='pending'),
 'customer_ready',exists(select 1 from pitacco_private.commercial_asaas_customers where store_id=b.store_id and environment='production'),
 'payment_id',a.payment_id,'customer_id',a.customer_id,'asaas_status',a.status,'issue_state',intent.state);
end $$;
revoke all on function public.pitacco_commercial_asaas_payment_context(uuid) from public,anon;
grant execute on function public.pitacco_commercial_asaas_payment_context(uuid) to authenticated;
