
-- New trial policy: only the first payment gets a 48-hour tolerance.
-- The separate global production-enforcement switch remains unchanged.
do $catalog$
declare rev text; offers jsonb;
begin
 select revision into rev from public.pitacco_plan_catalog_signal where singleton for update;
 if rev is distinct from '2026-11-24-v2' then raise exception 'Catálogo mudou; revise a política'; end if;
 select jsonb_agg(case when a.p->>'code'='complete' then a.p||jsonb_build_object(
 'first_payment_grace_hours',48,'description','Todas as funcionalidades disponíveis. R$ 59,90 pré-pagos. Novos clientes elegíveis: 15 dias de teste, aviso no vencimento e 48 horas para o primeiro pagamento. Migração sem teste, mediante pagamento confirmado.')
 else a.p end order by a.ord) into offers
 from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) with ordinality a(p,ord)
 where v.revision=rev;
 insert into pitacco_private.plan_catalog_versions(revision,plans) values('2026-11-24-v3',offers);
 update public.pitacco_plan_catalog_signal set revision='2026-11-24-v3' where singleton;
end $catalog$;
create function pitacco_private.first_trial_notice(p_now timestamptz,p_end timestamptz)
returns text language sql immutable set search_path='' as $$
 select case when p_end is null then 'none'
 when p_now>=p_end+interval '48 hours' then 'blocked'
 when p_now>=p_end then 'grace'
 when (p_now at time zone 'America/Sao_Paulo')::date=(p_end at time zone 'America/Sao_Paulo')::date then 'due_today'
 else 'none' end
$$;
revoke all on function pitacco_private.first_trial_notice(timestamptz,timestamptz) from public,anon,authenticated;
create function pitacco_private.first_trial_billing_notice(p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 select coalesce((
 select jsonb_build_object('first_payment_stage',pitacco_private.first_trial_notice(now(),state.trial_ends_at),
 'first_payment_due_at',state.trial_ends_at,'first_payment_grace_until',state.trial_ends_at+interval '48 hours')
 from public.pitacco_signup_trials t cross join lateral pitacco_private.subscription_state(p_store) state
 where t.first_store_id=p_store
 and t.started_at>=(select created_at from pitacco_private.plan_catalog_versions where revision='2026-11-24-v2')
 and state.trial_ends_at is not null and state.paid_until is null and state.status in ('trial','overdue')
 and not exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=p_store and c.plan_code='free' and c.effective_from<=(now() at time zone 'America/Sao_Paulo')::date)
 ),jsonb_build_object('first_payment_stage','none'))
$$;
revoke all on function pitacco_private.first_trial_billing_notice(uuid) from public,anon,authenticated;
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_store_subscription_status(uuid)'::regprocedure) into d;
 a:='(control.enforce_new_orders and state.status=''overdue'')';
 if position(a in d)=0 or position('return result;' in d)=0 then raise exception 'Subscription status changed';end if;
 d:=replace(d,a,'(control.enforce_new_orders and state.status=''overdue'' and pitacco_private.first_trial_billing_notice(p_store)->>''first_payment_stage'' is distinct from ''grace'')');
 d:=replace(d,'return result;','return result||pitacco_private.first_trial_billing_notice(p_store);');
 execute d;
 select pg_get_functiondef('pitacco_private.enforce_subscription_for_order()'::regprocedure) into d;
 a:='state.status=''overdue'' and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders)';
 if position(a in d)=0 then raise exception 'Subscription guard changed';end if;
 execute replace(d,a,a||' and pitacco_private.first_trial_billing_notice(new.store_id)->>''first_payment_stage'' is distinct from ''grace''');
end $patch$;

