
-- Asaas payment IDs identify individual Pitacco invoices, not entire stores.
create table pitacco_private.asaas_commercial_customers(
 store_id uuid primary key references public.stores(id),
 customer_id text not null unique check(customer_id ~ '^cus_[A-Za-z0-9_-]{1,100}$'),
 created_at timestamptz not null default now()
);
create table pitacco_private.asaas_commercial_charges(
 invoice_id uuid primary key references pitacco_private.commercial_invoices(id),
 customer_id text not null references pitacco_private.asaas_commercial_customers(customer_id),
 payment_id text unique check(payment_id ~ '^pay_[A-Za-z0-9_-]{1,100}$'),
 created_at timestamptz not null default now(),
 confirmed_at timestamptz
);
alter table pitacco_private.asaas_commercial_customers enable row level security;
alter table pitacco_private.asaas_commercial_charges enable row level security;
revoke all on pitacco_private.asaas_commercial_customers,pitacco_private.asaas_commercial_charges from public,anon,authenticated;
-- One settlement ledger for manual and provider-confirmed payments. Automated
-- entries have no human verifier; do not fabricate an administrator identity.
alter table pitacco_private.commercial_manual_payments add column payment_source text not null default 'manual';
alter table pitacco_private.commercial_manual_payments alter column verified_by drop not null;
alter table pitacco_private.commercial_manual_payments add constraint commercial_settlement_source_check check(
 (payment_source='manual' and verified_by is not null) or (payment_source='asaas' and verified_by is null)
);
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.fixo_prepaid_manual_confirmed()'::regprocedure) into d;
 a:='insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details)';
 if position(a in d)=0 then raise exception 'Fixo settlement trigger changed';end if;
 d:=replace(d,a,'if new.verified_by is not null then '||a);
 d:=replace(d,'''first_activation'',st.activated_at is null));','''first_activation'',st.activated_at is null)); end if;');
 a:='if st.activated_at is null then';
 if position(a in d)=0 then raise exception 'Fixo activation changed';end if;
 d:=replace(d,a,'if st.activated_at is null and st.request_id is not null and not exists(select 1 from pitacco_private.plan_change_requests r where r.id=st.request_id and r.status=''in_review'') then raise exception ''Solicitação não está apta à ativação; conciliação necessária''; end if; '||a);
 execute d;
end $patch$;
create function public.pitacco_asaas_settle_commercial_invoice(p_payment_id text,p_customer_id text,p_invoice uuid,p_amount_cents bigint)
returns text language plpgsql security definer set search_path='' as $$
declare i pitacco_private.commercial_invoices%rowtype; b pitacco_private.commercial_closings%rowtype; c pitacco_private.asaas_commercial_charges%rowtype; existing pitacco_private.commercial_manual_payments%rowtype;
begin
 if not exists(select 1 from pitacco_private.subscription_control where asaas_environment='production') then return 'environment_disabled';end if;
 if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_-]{1,100}$' or p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9_-]{1,100}$' or p_invoice is null or p_amount_cents is null then return 'invalid';end if;
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found then return 'not_linked';end if;
 select * into c from pitacco_private.asaas_commercial_charges where invoice_id=p_invoice for update;
 if not found or c.payment_id is distinct from p_payment_id or c.customer_id is distinct from p_customer_id then return 'not_linked';end if;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end;
 if not exists(select 1 from pitacco_private.asaas_commercial_customers where store_id=b.store_id and customer_id=p_customer_id) or i.amount_cents is distinct from p_amount_cents or b.amount_cents is distinct from p_amount_cents or b.state is distinct from 'calculated' then return 'review_required';end if;
 select * into existing from pitacco_private.commercial_manual_payments where invoice_id=i.id;
 if found then
  if existing.payment_source='asaas' and existing.reference='asaas:'||p_payment_id then return 'duplicate';end if;
  return 'review_required';
 end if;
 insert into pitacco_private.commercial_manual_payments(invoice_id,amount_cents,reference,verified_by,note,payment_source)
 values(i.id,p_amount_cents,'asaas:'||p_payment_id,null,'Pagamento verificado na API do Asaas','asaas');
 update pitacco_private.asaas_commercial_charges set confirmed_at=now() where invoice_id=i.id;
 return 'processed';
end $$;
revoke all on function public.pitacco_asaas_settle_commercial_invoice(text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.pitacco_asaas_settle_commercial_invoice(text,text,uuid,bigint) to service_role;

