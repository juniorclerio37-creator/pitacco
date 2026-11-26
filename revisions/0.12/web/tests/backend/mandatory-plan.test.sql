begin;
do $test$
declare s uuid; other uuid; u uuid:=gen_random_uuid(); p uuid; f uuid; req uuid; offer jsonb; src text; prior_order uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u::text||'@example.invalid',now());
 insert into public.stores(name) values('Plan choice fixture') returning id into s;
 insert into public.stores(name) values('Prepaid fixture') returning id into other;
 insert into public.store_members(store_id,user_id,role) values(s,u,'gestor'),(other,u,'gestor');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 update pitacco_private.commercial_billing_control set require_selected_plan=true,enforce_own_orders=false where singleton;
 insert into pitacco_private.subscription_admin_controls(store_id,courtesy_until) values(s,now()+interval '30 days');
 assert pitacco_private.commercial_plan_access(s)='selection_required';
 assert pitacco_private.commercial_orders_blocked(s);
 assert public.pitacco_store_commercial_block_status(s)->>'notice_stage'='plan_required';
 assert public.pitacco_merchant_subscription_details(s)->>'plan_code' is null;
 foreach src in array array['proprio','ifood','99food','keeta'] loop
 begin
  insert into public.orders(store_id,channel,gross,status,source) values(s,'Delivery próprio',20,'pending',src);
  raise exception 'TEST no plan accepted';
 exception when raise_exception then if sqlerrm not like 'Estabelecimento sem plano.%' then raise;end if;end;
 end loop;
 req:=public.pitacco_merchant_confirm_plan_change(s,'free','2026-11-24-v4');
 assert req is not null and pitacco_private.commercial_plan_access(s)='ready';
 assert not pitacco_private.commercial_orders_blocked(s);
 insert into public.orders(store_id,channel,gross,status,source) values(s,'Delivery próprio',20,'pending','proprio') returning id into prior_order;
 update pitacco_private.commercial_contracts set valid_until_at=now() where store_id=s;
 assert pitacco_private.commercial_orders_blocked(s);
 update public.orders set status='accepted' where id=prior_order;
 assert (select status='accepted' from public.orders where id=prior_order);
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision='2026-11-24-v4' and x->>'code'='complete';
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(other,'2026-11-24-v4','complete',(now() at time zone 'America/Sao_Paulo')::date,offer,u) returning id into f;
 insert into pitacco_private.fixo_prepaid_state(contract_id,first_due_at,first_trial_grace) values(f,now(),false);
 assert pitacco_private.commercial_plan_access(other)='payment_required' and pitacco_private.commercial_orders_blocked(other);
 assert public.pitacco_store_commercial_block_status(other)->>'notice_stage'='activation_pending';
 update pitacco_private.fixo_prepaid_state set activated_at=now(),paid_until=now()+interval '30 days' where contract_id=f;
 assert pitacco_private.commercial_plan_access(other)='ready' and not pitacco_private.commercial_orders_blocked(other);
 update pitacco_private.fixo_prepaid_state set activated_at=null,paid_until=null,first_trial_grace=true,first_due_at=now()+interval '15 days' where contract_id=f;
 assert pitacco_private.commercial_plan_access(other)='ready' and not pitacco_private.commercial_orders_blocked(other);
 assert not has_function_privilege('anon','pitacco_private.commercial_plan_access(uuid)','EXECUTE');
end $test$;
rollback;