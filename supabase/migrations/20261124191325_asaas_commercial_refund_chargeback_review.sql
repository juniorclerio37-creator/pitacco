
create table pitacco_private.asaas_commercial_incidents(
 invoice_id uuid not null references pitacco_private.commercial_invoices(id),
 payment_id text not null references pitacco_private.asaas_commercial_charges(payment_id),
 event_type text not null check(event_type in ('PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL','PAYMENT_DELETED')),
 provider_status text not null check(length(provider_status) between 1 and 80),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 primary key(invoice_id,event_type)
);
alter table pitacco_private.asaas_commercial_incidents enable row level security;
revoke all on pitacco_private.asaas_commercial_incidents from public,anon,authenticated;
create function public.pitacco_asaas_record_commercial_incident(p_invoice uuid,p_payment text,p_customer text,p_event text,p_status text)
returns text language plpgsql security definer set search_path='' as $$
declare c pitacco_private.asaas_commercial_charges%rowtype;
begin
 if not exists(select 1 from pitacco_private.subscription_control where asaas_environment='production') then return 'environment_disabled';end if;
 if p_event is null or p_event not in ('PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL','PAYMENT_DELETED') or p_status is null or length(p_status) not between 1 and 80 then return 'invalid';end if;
 perform 1 from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found then return 'not_linked';end if;
 select * into c from pitacco_private.asaas_commercial_charges where invoice_id=p_invoice for update;
 if not found or c.payment_id is distinct from p_payment or c.customer_id is distinct from p_customer then return 'not_linked';end if;
 insert into pitacco_private.asaas_commercial_incidents(invoice_id,payment_id,event_type,provider_status)
 values(p_invoice,p_payment,p_event,p_status)
 on conflict(invoice_id,event_type) do update set provider_status=excluded.provider_status,last_seen_at=now();
 return 'review_required';
end $$;
revoke all on function public.pitacco_asaas_record_commercial_incident(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_asaas_record_commercial_incident(uuid,text,text,text,text) to service_role;
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_commercial_invoices(uuid,integer)'::regprocedure) into d;
 a:='pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until) as status,';
 if position(a in d)=0 then raise exception 'Invoice view changed';end if;
 d:=replace(d,a,'case when exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) then ''review_required'' else pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until) end as status, (select jsonb_agg(jsonb_build_object(''event'',ai.event_type,''status'',ai.provider_status,''first_seen_at'',ai.first_seen_at) order by ai.first_seen_at) from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) as asaas_incidents,');
 execute d;
 select pg_get_functiondef('public.pitacco_asaas_settle_commercial_invoice(text,text,uuid,bigint)'::regprocedure) into d;
 a:='select * into existing from pitacco_private.commercial_manual_payments';
 if position(a in d)=0 then raise exception 'Settlement changed';end if;
 execute replace(d,a,'if exists(select 1 from pitacco_private.asaas_commercial_incidents where invoice_id=i.id) then return ''review_required'';end if; '||a);
 select pg_get_functiondef('public.pitacco_asaas_reserve_charge(uuid,uuid,text)'::regprocedure) into d;
 a:='if b.state is distinct from ''calculated''';
 if position(a in d)=0 then raise exception 'Reservation changed';end if;
 execute replace(d,a,'if exists(select 1 from pitacco_private.asaas_commercial_incidents where invoice_id=i.id) then raise exception ''Fatura em conciliação financeira'';end if; '||a);
end $patch$;

