
create table pitacco_private.fixo_prepaid_state (
 contract_id uuid primary key references pitacco_private.commercial_contracts(id),
 request_id uuid unique references pitacco_private.plan_change_requests(id),
 first_due_at timestamptz not null,
 activated_at timestamptz,
 paid_until timestamptz,
 check ((activated_at is null and paid_until is null) or
        (activated_at is not null and paid_until>activated_at))
);
alter table pitacco_private.fixo_prepaid_state enable row level security;
revoke all on pitacco_private.fixo_prepaid_state from public,anon,authenticated;
create function pitacco_private.fixo_prepaid_next_end(p_now timestamptz,p_paid_until timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select ((greatest(p_now,p_paid_until) at time zone 'America/Sao_Paulo')+interval '1 month') at time zone 'America/Sao_Paulo'
$$;
revoke all on function pitacco_private.fixo_prepaid_next_end(timestamptz,timestamptz) from public,anon,authenticated;
create function pitacco_private.ensure_fixo_prepaid_invoice(p_contract uuid)
returns uuid language plpgsql set search_path='' as $$
declare st pitacco_private.fixo_prepaid_state%rowtype; c pitacco_private.commercial_contracts%rowtype;
 v_invoice uuid; v_due timestamptz; v_start date; v_end date;
begin
 select * into st from pitacco_private.fixo_prepaid_state where contract_id=p_contract for update;
 if not found then return null;end if;
 select * into c from pitacco_private.commercial_contracts where id=p_contract;
 select i.id into v_invoice from pitacco_private.commercial_invoices i
 left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 where i.contract_id=p_contract and i.kind='monthly' and p.invoice_id is null
 order by i.created_at desc limit 1;
 if found then return v_invoice;end if;
 v_due:=coalesce(st.paid_until,st.first_due_at);
 if v_due>now()+interval '3 days' then return null;end if;
 v_start:=(v_due at time zone 'America/Sao_Paulo')::date;
 v_end:=(v_start+interval '1 month')::date;
 insert into pitacco_private.commercial_closings(contract_id,store_id,kind,period_start,period_end,due_at,grace_until,amount_cents,state,details)
 values(c.id,c.store_id,'monthly',v_start,v_end,v_due,v_due,5990,'calculated',
 jsonb_build_object('prepaid',true,'activation',st.activated_at is null,'coverage_starts_on_confirmed_payment',true))
 on conflict(contract_id,kind,period_end) do nothing;
 insert into pitacco_private.commercial_invoices(contract_id,kind,period_end,amount_cents,due_at,grace_until)
 values(c.id,'monthly',v_end,5990,v_due,v_due)
 on conflict(contract_id,kind,period_end) do nothing;
 select id into v_invoice from pitacco_private.commercial_invoices where contract_id=c.id and kind='monthly' and period_end=v_end;
 return v_invoice;
end $$;
revoke all on function pitacco_private.ensure_fixo_prepaid_invoice(uuid) from public,anon,authenticated;
create function pitacco_private.fixo_prepaid_manual_confirmed()
returns trigger language plpgsql security definer set search_path='' as $$
declare st pitacco_private.fixo_prepaid_state%rowtype; i pitacco_private.commercial_invoices%rowtype; c pitacco_private.commercial_contracts%rowtype; v_end timestamptz;
begin
 select * into i from pitacco_private.commercial_invoices where id=new.invoice_id;
 if i.kind is distinct from 'monthly' then return new;end if;
 select * into st from pitacco_private.fixo_prepaid_state where contract_id=i.contract_id for update;
 if not found then return new;end if;
 if new.amount_cents<>5990 or i.amount_cents<>5990 then raise exception 'Valor inválido para o Completo Fixo';end if;
 select * into c from pitacco_private.commercial_contracts where id=i.contract_id;
 v_end:=pitacco_private.fixo_prepaid_next_end(now(),st.paid_until);
 update pitacco_private.fixo_prepaid_state set activated_at=coalesce(activated_at,now()),paid_until=v_end where contract_id=st.contract_id;
 if st.activated_at is null then
   update pitacco_private.commercial_contracts set effective_from=(now() at time zone 'America/Sao_Paulo')::date where id=c.id;
   update pitacco_private.plan_change_requests set status='approved',updated_at=now(),decision_note='Pagamento pré-pago confirmado; Completo Fixo ativado.' where id=st.request_id and status='in_review';
 end if;
 insert into public.subscriptions(store_id,status,monthly_amount,due_date,updated_at)
 values(c.store_id,'ativa',59.90,(v_end at time zone 'America/Sao_Paulo')::date,now())
 on conflict(store_id) do update set status=excluded.status,monthly_amount=excluded.monthly_amount,due_date=excluded.due_date,updated_at=excluded.updated_at;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details)
 values(c.store_id,new.verified_by,'fixo_prepaid_payment_activated',jsonb_build_object('invoice_id',new.invoice_id,'contract_id',c.id,'paid_until',v_end,'first_activation',st.activated_at is null));
 return new;
end $$;
revoke all on function pitacco_private.fixo_prepaid_manual_confirmed() from public,anon,authenticated;
create trigger pitacco_fixo_prepaid_manual_confirmed after insert on pitacco_private.commercial_manual_payments for each row execute function pitacco_private.fixo_prepaid_manual_confirmed();
-- Keep unpaid first contracts out of commercial calculations and stop the legacy
-- postpaid monthly generator for all explicitly enrolled prepaid contracts.
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.commercial_amount_calculate(uuid,date)'::regprocedure) into d;
 a:='from pitacco_private.commercial_contracts where store_id=p_store and effective_from<=day order by effective_from desc limit 1';
 if position(a in d)=0 then raise exception 'Commercial calculation changed';end if;
 execute replace(d,a,'from pitacco_private.commercial_contracts cc where cc.store_id=p_store and cc.effective_from<=day and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=cc.id and fp.activated_at is null) order by cc.effective_from desc limit 1');
 select pg_get_functiondef('pitacco_private.refresh_commercial_closings()'::regprocedure) into d;
 a:='from pitacco_private.commercial_contracts where effective_from<today order by store_id';
 if position(a in d)=0 then raise exception 'Commercial closing changed';end if;
 execute replace(d,a,'from pitacco_private.commercial_contracts cc where cc.effective_from<today and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=cc.id) order by cc.store_id');
 select pg_get_functiondef('public.pitacco_owner_schedule_commercial_contract(uuid,date,text)'::regprocedure) into d;
 a:='insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(r.store_id,r.terms_version,r.requested_plan,p_effective,offer,auth.uid()) returning id into result;';
 if position(a in d)=0 then raise exception 'Commercial scheduling changed';end if;
 execute replace(d,a, $insert$
 if r.requested_plan='complete' then
   if p_effective<>today then raise exception 'O Completo Fixo pré-pago é ativado no dia da confirmação do pagamento';end if;
   if (offer->>'monthly_cents')::integer<>5990 or (offer->>'commission_basis_points')::integer<>0 then raise exception 'Condições do Completo Fixo divergentes';end if;
   offer:=offer||jsonb_build_object('trial_days',0,'grace_hours',0,'prepaid',true);
   insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by)
   values(r.store_id,r.terms_version,r.requested_plan,p_effective,offer,auth.uid()) returning id into result;
   insert into pitacco_private.fixo_prepaid_state(contract_id,request_id,first_due_at) values(result,r.id,now());
   perform pitacco_private.ensure_fixo_prepaid_invoice(result);
   update pitacco_private.plan_change_requests set status='in_review',updated_at=now(),decided_by=auth.uid(),decision_note='Aguardando pagamento pré-pago de R$ 59,90.' where id=r.id;
   insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(r.store_id,auth.uid(),'fixo_prepaid_waiting_payment',jsonb_build_object('contract_id',result,'request_id',r.id,'reason',p_reason));
   return result;
 end if;
 $insert$||a);
end $patch$;
create or replace function pitacco_private.commercial_orders_blocked(p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (
   exists(select 1 from pitacco_private.fixo_prepaid_state fp join pitacco_private.commercial_contracts c on c.id=fp.contract_id
      where c.store_id=p_store and fp.activated_at is not null and fp.paid_until<=now())
   or (exists(select 1 from pitacco_private.commercial_billing_control where singleton and enforce_own_orders)
     and exists(select 1 from pitacco_private.commercial_invoices i
      join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
      left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
      where b.store_id=p_store and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=i.contract_id)
      and pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until)='overdue'))
 ) and not exists(select 1 from pitacco_private.subscription_admin_controls a where a.store_id=p_store and a.courtesy_until>now())
$$;
create or replace function pitacco_private.run_commercial_billing()
returns integer language plpgsql security definer set search_path='' as $$
declare n integer; fp record;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('pitacco-commercial-closing-v1',0)) then return 0;end if;
 perform pitacco_private.refresh_commercial_closings();
 n:=pitacco_private.issue_commercial_invoices();
 for fp in select contract_id from pitacco_private.fixo_prepaid_state loop
   perform pitacco_private.ensure_fixo_prepaid_invoice(fp.contract_id);
 end loop;
 return n;
end $$;
-- For explicitly activated Fixo contracts the paid coverage is authoritative.
-- Do not reinterpret legacy trial or payment records as Fixo coverage.
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.subscription_state(uuid)'::regprocedure) into d;
 a:='when coalesce(admin.suspended,false) then ''suspended''';
 if position(a in d)=0 then raise exception 'Subscription status changed';end if;
 d:=replace(d,a,a||E'\n   when prepaid.paid_until>now() then ''active''\n   when prepaid.contract_id is not null then ''overdue''');
 d:=replace(d,'greatest(trial.ends_at,admin.trial_extension_until),payment.paid_until','case when prepaid.contract_id is not null then null else greatest(trial.ends_at,admin.trial_extension_until) end,coalesce(prepaid.paid_until,payment.paid_until)');
 a:='where store.id=p_store';
 if position(a in d)=0 then raise exception 'Subscription lookup changed';end if;
 d:=replace(d,a,'left join lateral (select fp.contract_id,fp.paid_until from pitacco_private.fixo_prepaid_state fp join pitacco_private.commercial_contracts cc on cc.id=fp.contract_id where cc.store_id=store.id and fp.activated_at is not null order by fp.activated_at desc limit 1) prepaid on true '||a);
 execute d;
end $patch$;

