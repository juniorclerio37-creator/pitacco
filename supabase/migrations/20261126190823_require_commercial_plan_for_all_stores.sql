-- Mandatory plan selection is distinct from overdue-billing enforcement and courtesy.
-- Default on for production and fresh installations. No merchant or admin UI toggle.
alter table pitacco_private.commercial_billing_control add column if not exists require_selected_plan boolean not null default true;
update pitacco_private.commercial_billing_control set require_selected_plan=true where singleton;

create or replace function pitacco_private.commercial_plan_access(p_store uuid)
returns text language sql stable security definer set search_path='' as $$
 select case
 when not exists(select 1 from pitacco_private.commercial_billing_control where singleton and require_selected_plan) then 'ready'
 when exists(select 1 from pitacco_private.commercial_contracts c left join pitacco_private.fixo_prepaid_state fp on fp.contract_id=c.id
  where c.store_id=p_store and c.plan_code in ('free','complete')
   and c.effective_from<=(now() at time zone 'America/Sao_Paulo')::date
   and (c.valid_from_at is null or c.valid_from_at<=now())
   and (c.valid_until_at is null or c.valid_until_at>now())
   and (c.plan_code='free' or fp.contract_id is null or fp.first_trial_grace or fp.activated_at is not null)) then 'ready'
 when exists(select 1 from pitacco_private.commercial_contracts c join pitacco_private.fixo_prepaid_state fp on fp.contract_id=c.id
  where c.store_id=p_store and c.plan_code='complete' and fp.activated_at is null and not fp.first_trial_grace
   and (c.valid_until_at is null or c.valid_until_at>now())) then 'payment_required'
 else 'selection_required' end
$$;
revoke all on function pitacco_private.commercial_plan_access(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION pitacco_private.commercial_orders_blocked(p_store uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select pitacco_private.commercial_plan_access(p_store)<>'ready' or ((
   exists(select 1 from pitacco_private.fixo_prepaid_state fp join pitacco_private.commercial_contracts c on c.id=fp.contract_id
      where c.store_id=p_store and (c.valid_until_at is null or c.valid_until_at>now()) and fp.activated_at is not null and fp.paid_until<=now())
   or (exists(select 1 from pitacco_private.commercial_billing_control where singleton and enforce_own_orders)
     
 and (exists(select 1 from pitacco_private.asaas_commercial_resolutions ar join pitacco_private.commercial_invoices i on i.id=ar.invoice_id join pitacco_private.commercial_contracts c on c.id=i.contract_id where c.store_id=p_store and ar.decision='recovery_due' and ar.evidence=pitacco_private.asaas_incident_evidence(i.id) and now()>=ar.due_at) or exists(select 1 from pitacco_private.fixo_prepaid_state fp join pitacco_private.commercial_contracts c on c.id=fp.contract_id
   left join pitacco_private.subscription_admin_controls a on a.store_id=c.store_id
   where c.store_id=p_store and c.plan_code='complete' and fp.first_trial_grace and fp.activated_at is null
   and (c.valid_until_at is null or c.valid_until_at>now())
   and now()>=greatest(fp.first_due_at,a.trial_extension_until)+interval '48 hours')
 or exists(select 1 from pitacco_private.commercial_invoices i
 
      join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
      left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
      where b.store_id=p_store and (not exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) or pitacco_private.asaas_current_resolution(i.id)='manual_only') and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=i.contract_id)
      and pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until)='overdue')))
 ) and not exists(select 1 from pitacco_private.subscription_admin_controls a where a.store_id=p_store and a.courtesy_until>now()))
$function$;

CREATE OR REPLACE FUNCTION pitacco_private.control_store_order_gate(p_store uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'manual_blocked',st.status='suspended',
 'plan_access',pitacco_private.commercial_plan_access(p_store),
 'financial_blocked',pitacco_private.commercial_orders_blocked(p_store) or (st.status='overdue' and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders) and pitacco_private.first_trial_billing_notice(p_store)->>'first_payment_stage' is distinct from 'grace'),
 'automatic_enabled',exists(select 1 from pitacco_private.commercial_billing_control where singleton and enforce_own_orders),
 'orders_blocked',st.status='suspended' or pitacco_private.commercial_orders_blocked(p_store) or (st.status='overdue' and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders) and pitacco_private.first_trial_billing_notice(p_store)->>'first_payment_stage' is distinct from 'grace'),
 'courtesy_until',adm.courtesy_until,'observed_at',now())
 from pitacco_private.subscription_state(p_store) st
 left join pitacco_private.subscription_admin_controls adm on adm.store_id=p_store
$function$;

CREATE OR REPLACE FUNCTION pitacco_private.enforce_commercial_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status is distinct from 'historical'
 and pitacco_private.commercial_orders_blocked(new.store_id) then
  if pitacco_private.commercial_plan_access(new.store_id)='selection_required' then raise exception 'Estabelecimento sem plano. Escolha um plano na área de Assinaturas do Pitacco.' using errcode='P0001';end if;
  if pitacco_private.commercial_plan_access(new.store_id)='payment_required' then raise exception 'Estabelecimento aguardando ativação do plano. Confirme o pagamento na área de Assinaturas do Pitacco.' using errcode='P0001';end if;
  raise exception 'Estabelecimento bloqueado por inadimplência. Regularize as cobranças na área de assinaturas do Pitacco.' using errcode='P0001';
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_merchant_subscription_details(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão para consultar assinatura' using errcode='42501'; end if;
 select public.pitacco_store_subscription_status(s.id)||jsonb_build_object(
  'plan_code',coalesce((select c.plan_code from pitacco_private.commercial_contracts c left join pitacco_private.fixo_prepaid_state fp on fp.contract_id=c.id where c.store_id=s.id and c.effective_from<=(now() at time zone 'America/Sao_Paulo')::date and (c.valid_until_at is null or c.valid_until_at>now()) and (c.valid_from_at is null or c.valid_from_at<=now()) and (fp.contract_id is null or fp.first_trial_grace or fp.activated_at is not null) order by c.effective_from desc limit 1),null),'registered_monthly_amount',sub.monthly_amount,'due_date',sub.due_date,
  'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.confirmed_at desc) from
   (select provider,amount,confirmed_at,paid_until from pitacco_private.subscription_payments
    where store_id=s.id order by confirmed_at desc limit 100) x),'[]'::jsonb)
 ) into result from public.stores s left join public.subscriptions sub on sub.store_id=s.id where s.id=p_store;
 if result is null then raise exception 'Loja não encontrada';end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_store_commercial_block_status(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare blocked boolean; v_stage text; due_time timestamptz; grace_time timestamptz; pending_count bigint; action_count bigint; total_count bigint;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.can_access_store(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 blocked:=pitacco_private.commercial_orders_blocked(p_store);
 with unpaid as (
 select i.due_at,i.grace_until,
 pitacco_private.commercial_notice_stage(now(),i.due_at,i.grace_until) as stage,
 exists(select 1 from pitacco_private.commercial_payment_claims c where c.invoice_id=i.id and c.status='pending') as awaiting_review
 from pitacco_private.commercial_invoices i
 join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 where b.store_id=p_store and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=i.contract_id and fp.activated_at is null and not fp.first_trial_grace) 
 and p.invoice_id is null and b.state='calculated' and b.amount_cents=i.amount_cents
 and (not exists(select 1 from pitacco_private.asaas_commercial_incidents ai where ai.invoice_id=i.id) or pitacco_private.asaas_current_resolution(i.id)='manual_only')
 union all
 select ar.decided_at,ar.due_at,case when now()>=ar.due_at then 'overdue' else 'grace' end,
 exists(select 1 from pitacco_private.commercial_payment_claims claim where claim.invoice_id=ar.invoice_id and claim.status='pending')
 from pitacco_private.asaas_commercial_resolutions ar join pitacco_private.commercial_invoices i on i.id=ar.invoice_id
 join pitacco_private.commercial_contracts c on c.id=i.contract_id
 where c.store_id=p_store and ar.decision='recovery_due' and ar.evidence=pitacco_private.asaas_incident_evidence(i.id)
 
 ), relevant as (select * from unpaid where stage<>'none'), ranked as (
 select * from relevant order by case stage when 'overdue' then 1 when 'grace' then 2 else 3 end,grace_until,due_at limit 1
 )
 select (select r.stage from ranked r),(select r.due_at from ranked r),(select r.grace_until from ranked r),
 count(*) filter(where awaiting_review),count(*) filter(where not awaiting_review),count(*)
 into v_stage,due_time,grace_time,pending_count,action_count,total_count from relevant;
 return jsonb_build_object('orders_blocked',blocked,'plan_access',pitacco_private.commercial_plan_access(p_store),'notice_stage',case when pitacco_private.commercial_plan_access(p_store)='selection_required' then 'plan_required' when pitacco_private.commercial_plan_access(p_store)='payment_required' then 'activation_pending' when blocked then 'blocked' else coalesce(v_stage,'none') end,
 'due_at',due_time,'grace_until',grace_time,'awaiting_review',pending_count,'payment_required',action_count,'unpaid_count',total_count);
end $function$;

CREATE OR REPLACE FUNCTION public.pitacco_store_subscription_status(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null or not public.can_access_store(p_store) then
  raise exception 'Sem permissão para consultar a assinatura desta loja';
 end if;
 select jsonb_build_object('status',state.status,'trial_ends_at',state.trial_ends_at,
  'paid_until',state.paid_until,'plan_access',pitacco_private.commercial_plan_access(p_store),'amount',case when pitacco_private.commercial_plan_access(p_store)='selection_required' then null else 59.90 end,
  'orders_blocked',(pitacco_private.commercial_orders_blocked(p_store) or state.status='suspended' or (control.enforce_new_orders and state.status='overdue' and pitacco_private.first_trial_billing_notice(p_store)->>'first_payment_stage' is distinct from 'grace')),
  'regularization_url',control.regularization_url)
 into result from pitacco_private.subscription_state(p_store) state
 cross join pitacco_private.subscription_control control;
 return result||pitacco_private.first_trial_billing_notice(p_store);
end;
$function$;
