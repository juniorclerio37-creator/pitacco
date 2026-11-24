-- Candidate: do not apply in production until the integration tests and rollout are approved.
-- Links are registered only by the trusted charge-creation backend, never by a webhook or browser.
create table pitacco_private.commercial_asaas_charges (
 invoice_id uuid primary key references pitacco_private.commercial_invoices(id),
 environment text not null check (environment in ('production','sandbox')),
 payment_id text not null check (payment_id ~ '^pay_[A-Za-z0-9_-]{1,100}$'),
 customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9_-]{1,100}$'),
 amount_cents bigint not null check (amount_cents>0),
 status text not null default 'pending' check (status in ('pending','confirmed','received','review_required')),
 provider_status text,
 verified_at timestamptz,
 created_at timestamptz not null default now(),
 unique(environment,payment_id)
);
alter table pitacco_private.commercial_asaas_charges enable row level security;
revoke all on pitacco_private.commercial_asaas_charges from public,anon,authenticated;
grant select,insert,update on pitacco_private.commercial_asaas_charges to service_role;

-- All callers hold the invoice lock before changing either payment path.
create function public.pitacco_link_commercial_asaas_charge(
 p_invoice uuid,p_environment text,p_payment_id text,p_customer_id text,p_amount_cents bigint
) returns text language plpgsql security invoker set search_path='' as $$
declare i pitacco_private.commercial_invoices%rowtype; b pitacco_private.commercial_closings%rowtype;
 existing pitacco_private.commercial_asaas_charges%rowtype;
begin
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found or i.amount_cents is distinct from p_amount_cents then return 'invalid_invoice'; end if;
 select * into b from pitacco_private.commercial_closings
 where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end for share;
 if b.state is distinct from 'calculated' or b.amount_cents is distinct from i.amount_cents then return 'review_required';end if;
 if exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) then return 'already_paid_manually';end if;
 select * into existing from pitacco_private.commercial_asaas_charges where invoice_id=i.id;
 if found then
  if (existing.environment,existing.payment_id,existing.customer_id,existing.amount_cents) is not distinct from
     (p_environment,p_payment_id,p_customer_id,p_amount_cents) then return 'already_linked';end if;
  return 'conflicting_link';
 end if;
 insert into pitacco_private.commercial_asaas_charges(invoice_id,environment,payment_id,customer_id,amount_cents)
 values(i.id,p_environment,p_payment_id,p_customer_id,p_amount_cents);
 return 'linked';
end $$;
revoke all on function public.pitacco_link_commercial_asaas_charge(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.pitacco_link_commercial_asaas_charge(uuid,text,text,text,bigint) to service_role;

-- Called exclusively after querying Asaas directly using server credentials.
-- Review is sticky: an administrator must reconcile reversals, discrepancies and duplicate payments.
create function public.pitacco_reconcile_commercial_asaas_charge(
 p_environment text,p_payment_id text,p_customer_id text,p_reference text,p_amount_cents bigint,p_status text
) returns text language plpgsql security invoker set search_path='' as $$
declare link pitacco_private.commercial_asaas_charges%rowtype; i pitacco_private.commercial_invoices%rowtype;
 b pitacco_private.commercial_closings%rowtype; next_status text;
begin
 select * into link from pitacco_private.commercial_asaas_charges where environment=p_environment and payment_id=p_payment_id;
 if not found then return 'unlinked';end if;
 select * into i from pitacco_private.commercial_invoices where id=link.invoice_id for update;
 select * into link from pitacco_private.commercial_asaas_charges where invoice_id=i.id for update;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end for share;
 if link.status='review_required' then return 'review_required';end if;
 if link.customer_id is distinct from p_customer_id or p_reference is distinct from ('pitacco:commercial:'||i.id::text)
 or link.amount_cents is distinct from p_amount_cents or i.amount_cents is distinct from p_amount_cents
 or b.state is distinct from 'calculated' or b.amount_cents is distinct from i.amount_cents
 or p_status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL','PARTIALLY_REFUNDED','RECEIVED_IN_CASH','DELETED')
 or (p_status in ('CONFIRMED','RECEIVED') and exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id))
 then next_status:='review_required';
 elsif p_status='RECEIVED' then next_status:='received';
 elsif p_status='CONFIRMED' and link.status<>'received' then next_status:='confirmed';
 elsif p_status in ('PENDING','OVERDUE') and link.status in ('confirmed','received') then next_status:='review_required';
 else next_status:=link.status;
 end if;
 update pitacco_private.commercial_asaas_charges set status=next_status,provider_status=p_status,verified_at=now() where invoice_id=i.id;
 return next_status;
end $$;
revoke all on function public.pitacco_reconcile_commercial_asaas_charge(text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.pitacco_reconcile_commercial_asaas_charge(text,text,text,text,bigint,text) to service_role;

-- Read-side candidate: the next migration must switch all five existing commercial
-- readers/writers to this shared settlement state and add a tested manual/provider
-- cancellation workflow before any automatic charge is issued.
create view pitacco_private.commercial_settlement_candidate with (security_invoker=true) as
select i.id as invoice_id,
 case when a.status='review_required' then 'review_required'
      when m.invoice_id is not null then 'paid_manual'
      when a.status in ('confirmed','received') then 'paid_asaas'
      else 'unpaid' end as settlement_state,
 a.payment_id,a.provider_status,a.verified_at
from pitacco_private.commercial_invoices i
left join pitacco_private.commercial_manual_payments m on m.invoice_id=i.id
left join pitacco_private.commercial_asaas_charges a on a.invoice_id=i.id;
revoke all on pitacco_private.commercial_settlement_candidate from public,anon,authenticated;
grant select on pitacco_private.commercial_settlement_candidate to service_role;
