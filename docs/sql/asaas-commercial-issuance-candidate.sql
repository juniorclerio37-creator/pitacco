-- Candidate only; apply after asaas-commercial-reconciliation-candidate.sql.
-- Explicit enrollment: no customer data is sent to Asaas until a store has a verified customer mapping.
create table pitacco_private.commercial_asaas_customers(
 store_id uuid not null references public.stores(id),
 environment text not null check(environment in ('production','sandbox')),
 customer_id text not null check(customer_id ~ '^cus_[A-Za-z0-9_-]{1,100}$'),
 primary key(store_id,environment),unique(environment,customer_id)
);
create table pitacco_private.commercial_asaas_issue_intents(
 invoice_id uuid primary key references pitacco_private.commercial_invoices(id),
 environment text not null check(environment in ('production','sandbox')),
 customer_id text not null,
 amount_cents bigint not null check(amount_cents>0),
 billing_type text not null check(billing_type in ('PIX','BOLETO','UNDEFINED')),
 due_date date not null,
 state text not null default 'reserved' check(state in ('reserved','linked','review_required')),
 created_at timestamptz not null default now()
);
alter table pitacco_private.commercial_asaas_customers enable row level security;
alter table pitacco_private.commercial_asaas_issue_intents enable row level security;
revoke all on pitacco_private.commercial_asaas_customers,pitacco_private.commercial_asaas_issue_intents from public,anon,authenticated,service_role;
-- A reservation is durable before the HTTP POST. A repeated call is recovery-only;
-- a timeout cannot produce an automatic second POST.
create function pitacco_private.reserve_commercial_asaas_issue(p_invoice uuid,p_environment text,p_billing_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i pitacco_private.commercial_invoices%rowtype; b pitacco_private.commercial_closings%rowtype;
 m pitacco_private.commercial_asaas_customers%rowtype; a pitacco_private.commercial_asaas_issue_intents%rowtype;
begin
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found then return jsonb_build_object('outcome','unavailable');end if;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end for share;
 if b.state is distinct from 'calculated' or b.amount_cents is distinct from i.amount_cents or exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) then return jsonb_build_object('outcome','unavailable');end if;
 if exists(select 1 from pitacco_private.commercial_asaas_charges where invoice_id=i.id) then return jsonb_build_object('outcome','already_linked');end if;
 select * into a from pitacco_private.commercial_asaas_issue_intents where invoice_id=i.id;
 if found then return jsonb_build_object('outcome','recover_only','invoice_id',a.invoice_id,'environment',a.environment,'customer_id',a.customer_id,'amount_cents',a.amount_cents,'billing_type',a.billing_type,'due_date',a.due_date);end if;
 select * into m from pitacco_private.commercial_asaas_customers where store_id=b.store_id and environment=p_environment;
 if not found or p_billing_type not in ('PIX','BOLETO','UNDEFINED') or (i.due_at at time zone 'America/Sao_Paulo')::date < (now() at time zone 'America/Sao_Paulo')::date then return jsonb_build_object('outcome','unavailable');end if;
 if exists(select 1 from pitacco_private.commercial_payment_claims where invoice_id=i.id and status='pending') then return jsonb_build_object('outcome','manual_review_pending');end if;
 insert into pitacco_private.commercial_asaas_issue_intents(invoice_id,environment,customer_id,amount_cents,billing_type,due_date)
 values(i.id,p_environment,m.customer_id,i.amount_cents,p_billing_type,(i.due_at at time zone 'America/Sao_Paulo')::date) returning * into a;
 return jsonb_build_object('outcome','reserved','invoice_id',a.invoice_id,'environment',a.environment,'customer_id',a.customer_id,'amount_cents',a.amount_cents,'billing_type',a.billing_type,'due_date',a.due_date);
end $$;
revoke all on function pitacco_private.reserve_commercial_asaas_issue(uuid,text,text) from public,anon,authenticated;
grant execute on function pitacco_private.reserve_commercial_asaas_issue(uuid,text,text) to service_role;
create function public.pitacco_reserve_commercial_asaas_issue(p_invoice uuid,p_environment text,p_billing_type text)
returns jsonb language sql security invoker set search_path='' as $$
 select pitacco_private.reserve_commercial_asaas_issue(p_invoice,p_environment,p_billing_type)
$$;
revoke all on function public.pitacco_reserve_commercial_asaas_issue(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_reserve_commercial_asaas_issue(uuid,text,text) to service_role;
-- Do not silently allow two channels to collect the same invoice. A cancellation/review
-- workflow must be added before allowing channel switching; no automatic deletion here.
create function pitacco_private.guard_manual_asaas_conflict() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from pitacco_private.commercial_invoices where id=new.invoice_id for update;
 if exists(select 1 from pitacco_private.commercial_asaas_issue_intents where invoice_id=new.invoice_id)
 or exists(select 1 from pitacco_private.commercial_asaas_charges where invoice_id=new.invoice_id)
 then raise exception 'Cobrança Asaas em aberto ou em conciliação; regularize o canal antes de confirmar Pix manual' using errcode='22023';end if;
 return new;
end $$;
revoke all on function pitacco_private.guard_manual_asaas_conflict() from public,anon,authenticated,service_role;
create trigger commercial_manual_asaas_conflict before insert on pitacco_private.commercial_manual_payments for each row execute function pitacco_private.guard_manual_asaas_conflict();
