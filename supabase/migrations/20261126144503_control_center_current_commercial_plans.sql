-- Administrative read models use the current commercial contract, never the legacy stores.plan.
-- Preserve billing, historical payments, contract terms and all write operations.
do $patch$
declare d text; anchor text; replacement text;
begin
 select pg_get_functiondef('public.pitacco_owner_subscription_details()'::regprocedure) into d;
 anchor:=$old$'plan',s.plan,'monthly_amount',sub.monthly_amount,$old$;
 replacement:=$new$'plan',commercial.plan_code,'monthly_amount',case when commercial.plan_code in ('free','complete') then (commercial.terms->>'monthly_cents')::numeric/100 end,
 'commission_basis_points',case when commercial.plan_code in ('free','complete') then (commercial.terms->>'commission_basis_points')::integer end,
 'billing_cycle',commercial.terms->>'billing_cycle','contract_revision',commercial.revision,$new$;
 if strpos(d,anchor)>0 then
  d:=replace(d,anchor,replacement);
  anchor:=$old$left join public.subscriptions sub on sub.store_id=s.id$old$;
  if strpos(d,anchor)=0 then raise exception 'Subscription join anchor not found';end if;
  d:=replace(d,anchor,anchor||$new$
 left join lateral(select cc.plan_code,cc.terms,cc.revision from pitacco_private.commercial_contracts cc where cc.store_id=s.id and cc.effective_from<=(now() at time zone 'America/Sao_Paulo')::date and (cc.valid_from_at is null or cc.valid_from_at<=now()) and (cc.valid_until_at is null or cc.valid_until_at>now()) and cc.plan_code in ('free','complete') order by cc.effective_from desc,cc.created_at desc limit 1) commercial on true$new$);
  execute d;
 elsif strpos(d,replacement)=0 then raise exception 'Subscription plan anchor not found';end if;
 select pg_get_functiondef('public.pitacco_control_stores(text,text,text,text,integer)'::regprocedure) into d;
 anchor:=$old$coalesce(c.plan_code,s.plan) as plan$old$;
 replacement:=$new$case when c.plan_code in ('free','complete') then c.plan_code end as plan$new$;
 if strpos(d,anchor)>0 then execute replace(d,anchor,replacement);
 elsif strpos(d,replacement)=0 then raise exception 'Directory plan anchor not found';end if;
end $patch$;
do $verify$
begin
 assert not has_function_privilege('anon','public.pitacco_owner_subscription_details()','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_control_stores(text,text,text,text,integer)','EXECUTE');
end $verify$;
