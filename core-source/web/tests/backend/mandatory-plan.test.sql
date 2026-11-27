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
-- Every future store gets a central library on import; equivalent configurations
-- share one template, while equal names with different prices stay distinct.
begin;
do $test$
declare s uuid; u uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid');
 insert into public.stores(name) values('Fixture import groups') returning id into s;
 insert into public.store_members(store_id,user_id,role) values(s,u,'gestor');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform public.pitacco_menu_import_apply(s,'[{"name":"Copo 1","category":"Açaí","price":20,"groups":[{"name":"Complementos","min":0,"max":2,"options":[{"name":"Leite","price":0},{"name":"Granola","price":1}]},{"name":"Complementos","min":0,"max":2,"options":[{"name":"Leite","price":0},{"name":"Granola","price":1}]}]},{"name":"Copo 2","category":"Açaí","price":22,"groups":[{"name":"Complementos","min":0,"max":2,"options":[{"name":"Leite","price":0},{"name":"Granola","price":1}]},{"name":"Complementos","min":0,"max":2,"options":[{"name":"Leite","price":2},{"name":"Granola","price":1}]}]}]'::jsonb,'add','fixture');
 assert (select count(*)=4 and count(library_template_id)=4 from public.product_option_groups where store_id=s);
 assert (select count(*)=3 from public.pitacco_complement_templates where store_id=s);
 assert (select count(*)=8 and count(library_option_id)=8 from public.product_options where store_id=s);
 assert (select count(*)=2 from pitacco_private.complement_registry where store_id=s);
 assert (select count(*)=1 from public.product_options where store_id=s and name='Leite' and additional_price=2);
 assert not exists(select 1 from public.product_option_groups where store_id=s group by product_id,library_template_id having count(*)>1);
 assert pitacco_private.centralize_unlinked_import_groups(s)=0;
end $test$;
rollback;

-- The real public signup RPC must create the contract and the trial atomically.
begin;
do $test$
declare u uuid; plan text; s uuid; e timestamptz; doc text; j int; i int; sumd int; d int; c uuid; same_store uuid;
begin
 -- Match production's enabled billing enforcement, not the isolated bootstrap default.
 update pitacco_private.commercial_billing_control set require_selected_plan=true,enforce_own_orders=true,payment_instructions='Teste isolado de cobrança',pix_cnpj='00000000000000',pix_recipient='Fixture de teste' where singleton;
 foreach plan in array array['free','complete'] loop
  u:=gen_random_uuid();
  insert into auth.users(id,email,email_confirmed_at) values(u,'signup-fixture-'||u||'@example.invalid',now());
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  doc:=lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0');
  for j in 10..11 loop
   sumd:=0;for i in 1..j-1 loop sumd:=sumd+substring(doc,i,1)::int*(j+1-i);end loop;
   d:=(sumd*10)%11;doc:=doc||case when d=10 then '0' else d::text end;
  end loop;
  begin perform public.pitacco_register_store_plan('Fixture cadastro',doc,null,'2026-11-24-v4');raise exception 'TEST accepted missing plan';exception when raise_exception then if sqlerrm<>'Escolha o plano' then raise;end if;end;
  select r.store_id,r.trial_ends_at into s,e from public.pitacco_register_store_plan('Fixture cadastro',doc,plan,'2026-11-24-v4') r;
  assert s is not null;
  assert pitacco_private.commercial_plan_access(s)='ready';
  assert not pitacco_private.commercial_orders_blocked(s);
  select id into strict c from pitacco_private.commercial_contracts where store_id=s and plan_code=plan;
  if plan='free' then
    assert e is null;
    assert (select (terms->>'commission_basis_points')::int=200 and (terms->>'monthly_cents')::int=0 from pitacco_private.commercial_contracts where id=c);
  else
    assert e=now()+interval '15 days';
    assert (select first_due_at=e and first_trial_grace and activated_at is null from pitacco_private.fixo_prepaid_state where contract_id=c);
    update pitacco_private.fixo_prepaid_state set first_due_at=now()-interval '1 hour' where contract_id=c;
    update public.pitacco_signup_trials set ends_at=now()-interval '1 hour' where first_store_id=s;
    assert not pitacco_private.commercial_orders_blocked(s);
    update pitacco_private.fixo_prepaid_state set first_due_at=now()-interval '49 hours' where contract_id=c;
    update public.pitacco_signup_trials set ends_at=now()-interval '49 hours' where first_store_id=s;
    assert pitacco_private.commercial_orders_blocked(s), 'New Fixo blocks after 15 days plus 48-hour grace when billing is enabled';
  end if;
  select r.store_id into same_store from public.pitacco_register_store_plan('Fixture cadastro',doc,plan,'2026-11-24-v4') r;
  assert same_store=s;
  assert (select count(*)=1 from pitacco_private.commercial_contracts where store_id=s);
 end loop;
end $test$;
rollback;
