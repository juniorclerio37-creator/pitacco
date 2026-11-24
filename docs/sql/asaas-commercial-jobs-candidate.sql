-- Candidate only. The default stays manual; automatic issuance is opt-in per store.
alter table pitacco_private.commercial_asaas_customers add column auto_billing_type text check(auto_billing_type in ('PIX','BOLETO'));
create function public.pitacco_owner_asaas_auto_issue(p_store uuid,p_billing_type text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_billing_type is not null and p_billing_type not in ('PIX','BOLETO') then raise exception 'Forma de cobrança inválida' using errcode='22023';end if;
 update pitacco_private.commercial_asaas_customers set auto_billing_type=p_billing_type where store_id=p_store and environment='production';
 if not found then raise exception 'Cadastro financeiro indisponível' using errcode='22023';end if;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'commercial_asaas_auto_issue_changed',jsonb_build_object('billing_type',p_billing_type));
end $$;
revoke all on function public.pitacco_owner_asaas_auto_issue(uuid,text) from public,anon;
grant execute on function public.pitacco_owner_asaas_auto_issue(uuid,text) to authenticated;
create function pitacco_private.commercial_asaas_pending_jobs()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (
  select i.id as invoice_id,m.auto_billing_type as billing_type
  from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
  join pitacco_private.commercial_asaas_customers m on m.store_id=b.store_id and m.environment='production'
  where exists(select 1 from pitacco_private.commercial_billing_control where singleton and asaas_enabled)
   and m.auto_billing_type is not null and b.state='calculated' and i.amount_cents=b.amount_cents
   and (i.due_at at time zone 'America/Sao_Paulo')::date >= (now() at time zone 'America/Sao_Paulo')::date
   and not exists(select 1 from pitacco_private.commercial_manual_payments x where x.invoice_id=i.id)
   and not exists(select 1 from pitacco_private.commercial_payment_claims x where x.invoice_id=i.id and x.status='pending')
   and not exists(select 1 from pitacco_private.commercial_asaas_charges x where x.invoice_id=i.id)
   and not exists(select 1 from pitacco_private.commercial_asaas_issue_intents x where x.invoice_id=i.id)
  order by i.due_at,i.id limit 10
 ) j
$$;
revoke all on function pitacco_private.commercial_asaas_pending_jobs() from public,anon,authenticated;
grant execute on function pitacco_private.commercial_asaas_pending_jobs() to service_role;
create function public.pitacco_commercial_asaas_pending_jobs()
returns jsonb language sql stable security invoker set search_path='' as $$
 select pitacco_private.commercial_asaas_pending_jobs()
$$;
revoke all on function public.pitacco_commercial_asaas_pending_jobs() from public,anon,authenticated;
grant execute on function public.pitacco_commercial_asaas_pending_jobs() to service_role;
-- Periodic reconciliation, independent of delivery of a webhook.
create function pitacco_private.commercial_asaas_reconciliation_jobs()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from (
  select a.payment_id from pitacco_private.commercial_asaas_charges a
  where a.environment='production' and a.status in ('pending','confirmed','received')
   and (a.verified_at is null or a.verified_at<now()-interval '15 minutes')
   and (a.status<>'received' or a.created_at>now()-interval '120 days')
  order by a.verified_at nulls first,a.payment_id limit 10
 ) j
$$;
revoke all on function pitacco_private.commercial_asaas_reconciliation_jobs() from public,anon,authenticated;
grant execute on function pitacco_private.commercial_asaas_reconciliation_jobs() to service_role;
create function public.pitacco_commercial_asaas_reconciliation_jobs()
returns jsonb language sql stable security invoker set search_path='' as $$
 select pitacco_private.commercial_asaas_reconciliation_jobs()
$$;
revoke all on function public.pitacco_commercial_asaas_reconciliation_jobs() from public,anon,authenticated;
grant execute on function public.pitacco_commercial_asaas_reconciliation_jobs() to service_role;
