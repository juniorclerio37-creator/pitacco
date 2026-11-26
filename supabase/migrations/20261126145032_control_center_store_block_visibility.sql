-- Administrative visibility of the existing order gates. No billing or order write rule is changed.
create or replace function pitacco_private.control_store_order_gate(p_store uuid)
returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object(
 'manual_blocked',st.status='suspended',
 'financial_blocked',pitacco_private.commercial_orders_blocked(p_store) or (st.status='overdue' and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders) and pitacco_private.first_trial_billing_notice(p_store)->>'first_payment_stage' is distinct from 'grace'),
 'automatic_enabled',exists(select 1 from pitacco_private.commercial_billing_control where singleton and enforce_own_orders),
 'orders_blocked',st.status='suspended' or pitacco_private.commercial_orders_blocked(p_store) or (st.status='overdue' and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders) and pitacco_private.first_trial_billing_notice(p_store)->>'first_payment_stage' is distinct from 'grace'),
 'courtesy_until',adm.courtesy_until,'observed_at',now())
 from pitacco_private.subscription_state(p_store) st
 left join pitacco_private.subscription_admin_controls adm on adm.store_id=p_store
$fn$;
revoke all on function pitacco_private.control_store_order_gate(uuid) from public,anon,authenticated;
create or replace function public.pitacco_control_store_block_status(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare gate jsonb;
begin
 perform pitacco_private.control_require('stores');
 if not public.pitacco_is_platform_owner() then raise exception 'Acesso exclusivo do proprietário' using errcode='42501';end if;
 gate:=pitacco_private.control_store_order_gate(p_store);
 if gate is null then raise exception 'Loja não encontrada' using errcode='22023';end if;
 return gate||jsonb_build_object('billing',public.pitacco_store_commercial_block_status(p_store),
 'history',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'created_at',a.created_at,'reason',a.details->>'reason') order by a.created_at desc) from (select action,created_at,details from pitacco_private.subscription_admin_audit where store_id=p_store and action in ('suspend','reactivate','courtesy') order by created_at desc limit 20)a),'[]'::jsonb));
end $fn$;
revoke all on function public.pitacco_control_store_block_status(uuid) from public,anon;
grant execute on function public.pitacco_control_store_block_status(uuid) to authenticated;
do $patch$
declare d text; a text; b text;
begin
 select pg_get_functiondef('public.pitacco_control_stores(text,text,text,text,integer)'::regprocedure) into d;
 a:=$old$s.logo_path,st.status,$old$;
 b:=$new$s.logo_path,case when (gate.state->>'manual_blocked')::boolean then 'suspended' when (gate.state->>'financial_blocked')::boolean then 'overdue' else st.status end as status,
 (gate.state->>'orders_blocked')::boolean as orders_blocked,(gate.state->>'manual_blocked')::boolean as manual_blocked,(gate.state->>'financial_blocked')::boolean as financial_blocked,$new$;
 if strpos(d,a)>0 then
  d:=replace(d,a,b);
  a:=$old$cross join lateral pitacco_private.subscription_state(s.id) st$old$;
  if strpos(d,a)=0 then raise exception 'Directory gate join anchor missing';end if;
  d:=replace(d,a,a||$new$ cross join lateral (select pitacco_private.control_store_order_gate(s.id) as state) gate$new$);
  execute d;
 elsif strpos(d,b)=0 then raise exception 'Directory gate anchor missing';end if;
end $patch$;
do $verify$ begin
 assert not has_function_privilege('anon','public.pitacco_control_store_block_status(uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','pitacco_private.control_store_order_gate(uuid)','EXECUTE');
end $verify$;
