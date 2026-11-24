-- Migration candidate: validate in isolated PostgreSQL before generating/deploying the official migration.
-- Commercial offer catalog only; existing contracts and Asaas are not mutated.
create table pitacco_private.plan_catalog_versions(
 revision text primary key, plans jsonb not null, changed_by uuid, created_at timestamptz not null default now()
);
alter table pitacco_private.plan_catalog_versions enable row level security;
revoke all on pitacco_private.plan_catalog_versions from public,anon,authenticated;
insert into pitacco_private.plan_catalog_versions(revision,plans) values('2026-11-24-v1',
 '[{"code":"free","name":"Grátis para sempre","monthly_cents":0,"commission_basis_points":500,"billing_cycle":"weekly","trial_days":0,"available":true,"description":"Módulos essenciais. Comissão sobre produtos e complementos dos pedidos próprios, excluídos frete, descontos e cancelamentos."},{"code":"complete","name":"Completo","monthly_cents":5990,"commission_basis_points":0,"billing_cycle":"monthly","trial_days":30,"available":true,"description":"Pedidos ilimitados e acesso aos módulos do plano."}]');
create table public.pitacco_plan_catalog_signal(
 singleton boolean primary key default true check(singleton),
 revision text not null references pitacco_private.plan_catalog_versions(revision)
);
insert into public.pitacco_plan_catalog_signal(revision) values('2026-11-24-v1');
alter table public.pitacco_plan_catalog_signal enable row level security;
revoke all on public.pitacco_plan_catalog_signal from public,anon,authenticated;
grant select on public.pitacco_plan_catalog_signal to authenticated;
create policy catalog_signal_read on public.pitacco_plan_catalog_signal for select to authenticated using((select auth.uid()) is not null);
alter publication supabase_realtime add table public.pitacco_plan_catalog_signal;
alter table pitacco_private.plan_change_requests drop constraint plan_change_requests_terms_version_check;
alter table pitacco_private.plan_change_requests drop constraint plan_change_requests_requested_plan_check;
alter table pitacco_private.plan_change_requests add constraint plan_change_catalog_code_check check(requested_plan ~ '^[a-z][a-z0-9_-]{0,63}$');
alter table pitacco_private.plan_change_requests add constraint plan_change_catalog_revision_fk foreign key(terms_version) references pitacco_private.plan_catalog_versions(revision);
create or replace function public.pitacco_owner_plan_catalog()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 select jsonb_build_object('terms_version',v.revision,'plans',v.plans) into result
 from public.pitacco_plan_catalog_signal s join pitacco_private.plan_catalog_versions v on v.revision=s.revision where s.singleton;
 return result;
end $$;
create or replace function public.pitacco_owner_publish_plan_catalog(p_expected text,p_plans jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_revision text; new_revision text; plan jsonb; checked jsonb:='[]'::jsonb; code text; amount integer; commission integer; trial integer; title text; description text; available boolean; cycle text;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if jsonb_typeof(p_plans) is distinct from 'array' then raise exception 'Catálogo inválido' using errcode='22023';end if;
 if jsonb_array_length(p_plans) not between 2 and 50 then raise exception 'Informe entre 2 e 50 planos' using errcode='22023';end if;
 for plan in select value from jsonb_array_elements(p_plans) loop
  code:=plan->>'code'; title:=btrim(plan->>'name');
  if code is null or code !~ '^[a-z][a-z0-9_-]{0,63}$' or title is null or char_length(title) not between 1 and 100
   or coalesce(plan->>'monthly_cents','') !~ '^[0-9]{1,8}$'
   or coalesce(plan->>'commission_basis_points','') !~ '^[0-9]{1,5}$'
   or coalesce(plan->>'trial_days','') !~ '^[0-9]{1,3}$' then raise exception 'Condições inválidas' using errcode='22023';end if;
  description:=btrim(coalesce(plan->>'description',''));
  if char_length(description)>1000 or (plan ? 'available' and jsonb_typeof(plan->'available') is distinct from 'boolean') then raise exception 'Descrição ou disponibilidade inválida' using errcode='22023';end if;
  available:=coalesce((plan->>'available')::boolean,true);
  cycle:=plan->>'billing_cycle';
  if cycle is null or cycle not in ('weekly','monthly') then raise exception 'Periodicidade inválida' using errcode='22023';end if;
  amount:=(plan->>'monthly_cents')::integer; commission:=(plan->>'commission_basis_points')::integer; trial:=(plan->>'trial_days')::integer;
  if commission>10000 or trial>365 then raise exception 'Limites inválidos' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(checked) p where p->>'code'=code) then raise exception 'Plano duplicado' using errcode='22023';end if;
  checked:=checked||jsonb_build_array(jsonb_build_object('code',code,'name',title,'monthly_cents',amount,'commission_basis_points',commission,'trial_days',trial,'description',description,'available',available,'billing_cycle',cycle));
 end loop;
 if not exists(select 1 from jsonb_array_elements(checked) p where p->>'code'='free') or not exists(select 1 from jsonb_array_elements(checked) p where p->>'code'='complete') then raise exception 'Preserve os planos originais no catálogo; desative se necessário' using errcode='22023';end if;
 select revision into old_revision from public.pitacco_plan_catalog_signal where singleton for update;
 if old_revision is distinct from p_expected then raise exception 'Catálogo atualizado por outra sessão. Recarregue.' using errcode='40001';end if;
 new_revision:='catalog-'||gen_random_uuid()::text;
 insert into pitacco_private.plan_catalog_versions(revision,plans,changed_by) values(new_revision,checked,auth.uid());
 update public.pitacco_plan_catalog_signal set revision=new_revision where singleton;
 return jsonb_build_object('terms_version',new_revision,'plans',checked);
end $$;
create or replace function public.pitacco_merchant_plan_options(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 select jsonb_build_object('terms_version',v.revision,'activation_mode','review','plans',v.plans,
 'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from
 (select c.id,c.requested_plan,c.status,c.created_at,c.updated_at,c.decision_note,c.terms_version,
 (select p->>'name' from jsonb_array_elements(h.plans) p where p->>'code'=c.requested_plan) as plan_name
 from pitacco_private.plan_change_requests c join pitacco_private.plan_catalog_versions h on h.revision=c.terms_version where c.store_id=p_store order by c.created_at desc limit 20) r),'[]'::jsonb)) into result
 from public.pitacco_plan_catalog_signal s join pitacco_private.plan_catalog_versions v on v.revision=s.revision where s.singleton;
 return result;
end $$;
create or replace function public.pitacco_request_plan_change(p_store uuid,p_plan text,p_terms text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing pitacco_private.plan_change_requests%rowtype; new_id uuid;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 perform 1 from public.pitacco_plan_catalog_signal where singleton and revision=p_terms for share;
 if not found then raise exception 'Os termos foram atualizados. Revise o plano novamente.' using errcode='22023';end if;
 if not exists(select 1 from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) p where v.revision=p_terms and p->>'code'=p_plan and coalesce((p->>'available')::boolean,true)) then raise exception 'Plano indisponível' using errcode='22023';end if;
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja não encontrada';end if;
 select * into existing from pitacco_private.plan_change_requests where store_id=p_store and status in ('pending','in_review');
 if found then
  if existing.requested_plan=p_plan and existing.terms_version=p_terms then return existing.id;end if;
  raise exception 'Cancele a solicitação anterior antes de escolher outro plano';
 end if;
 insert into pitacco_private.plan_change_requests(store_id,requested_by,requested_plan,terms_version) values(p_store,auth.uid(),p_plan,p_terms) returning id into new_id;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'plan_change_requested',jsonb_build_object('request_id',new_id,'plan',p_plan,'terms',p_terms));
 return new_id;
end $$;

create or replace function public.pitacco_owner_plan_catalog_history()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from
 (select revision,plans,changed_by,created_at from pitacco_private.plan_catalog_versions order by created_at desc,revision desc limit 30) h),'[]'::jsonb);
end $$;
revoke all on function public.pitacco_owner_plan_catalog_history() from public,anon,authenticated;
grant execute on function public.pitacco_owner_plan_catalog_history() to authenticated;
revoke all on function public.pitacco_owner_plan_catalog(),public.pitacco_owner_publish_plan_catalog(text,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_owner_plan_catalog(),public.pitacco_owner_publish_plan_catalog(text,jsonb) to authenticated;
create or replace function public.pitacco_owner_plan_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $catalog$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from
 (select c.id,c.store_id,s.name as store_name,c.requested_plan,c.status,c.created_at,c.updated_at,c.decision_note,c.terms_version,
 (select p from jsonb_array_elements(h.plans) p where p->>'code'=c.requested_plan) as accepted_offer
 from pitacco_private.plan_change_requests c join public.stores s on s.id=c.store_id
 join pitacco_private.plan_catalog_versions h on h.revision=c.terms_version
 order by c.created_at desc limit 200) r),'[]'::jsonb);
end $catalog$;
create or replace function public.pitacco_owner_growth(p_months integer default 6)
returns jsonb language plpgsql stable security definer set search_path='' as $growth$
declare result jsonb; current_month timestamp:=date_trunc('month',now() at time zone 'America/Sao_Paulo');
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_months is null or p_months not between 1 and 12 then raise exception 'Período inválido' using errcode='22023';end if;
 with months as (select generate_series(current_month-make_interval(months=>p_months-1),current_month,interval '1 month') as month_start),
 stores as (select date_trunc('month',s.created_at at time zone 'America/Sao_Paulo') as month_start,count(*) as total from public.stores s where s.created_at>=(current_month-make_interval(months=>p_months-1)) at time zone 'America/Sao_Paulo' and s.created_at<=now() group by 1),
 orders as (select date_trunc('month',o.created_at at time zone 'America/Sao_Paulo') as month_start,count(*) as total,count(*) filter(where o.status='cancelled') as cancelled from public.orders o where o.created_at>=(current_month-make_interval(months=>p_months-1)) at time zone 'America/Sao_Paulo' and o.created_at<=now() and o.status<>'historical' and coalesce(o.receipt->>'is_test','false')='false' and coalesce(o.receipt->>'test','false')='false' and coalesce(o.receipt->>'ifood_test','false')='false' group by 1)
 select jsonb_build_object('months',jsonb_agg(jsonb_build_object('month',m.month_start::date,'new_stores',coalesce(s.total,0),'orders',coalesce(o.total,0),'cancelled',coalesce(o.cancelled,0)) order by m.month_start)) into result from months m left join stores s using(month_start) left join orders o using(month_start);
 return result;
end $growth$;
revoke all on function public.pitacco_owner_growth(integer) from public,anon,authenticated;
grant execute on function public.pitacco_owner_growth(integer) to authenticated;
create or replace function public.pitacco_owner_store_members(p_store uuid,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $members$
declare j jsonb;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_store is null or p_page is null or p_page not between 0 and 100000 then raise exception 'Filtro inválido' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]'::jsonb) into j from
 (select m.user_id,u.email,to_jsonb(m)->>'role' as role from public.store_members m join auth.users u on u.id=m.user_id where m.store_id=p_store order by m.user_id offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25);
end $members$;
create or replace function public.pitacco_owner_campaign_rows(p_store uuid,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $campaign$
declare j jsonb;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_store is null or p_page is null or p_page not between 0 and 100000 then raise exception 'Filtro inválido' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) into j from
 (select id,code,kind,discount_type,discount_value,uses,max_uses,starts_at,expires_at,active,created_at from public.loyalty_coupons where store_id=p_store and kind in ('coupon','campaign') and target_customer_id is null order by created_at desc,id offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25);
end $campaign$;
create or replace function public.pitacco_owner_campaign_active(p_store uuid,p_coupon uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $campaign$
declare before_active boolean;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_active is null then raise exception 'Situação inválida' using errcode='22023';end if;
 select active into before_active from public.loyalty_coupons where id=p_coupon and store_id=p_store and kind in ('coupon','campaign') and target_customer_id is null for update;
 if not found then raise exception 'Campanha indisponível' using errcode='22023';end if;
 if before_active=p_active then return;end if;
 update public.loyalty_coupons set active=p_active where id=p_coupon and store_id=p_store;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'campaign_availability',jsonb_build_object('coupon_id',p_coupon,'before',before_active,'after',p_active));
end $campaign$;
create or replace function public.pitacco_owner_live_positions(p_store uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $fleet$
declare j jsonb;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.observed_at desc,x.id),'[]'::jsonb) into j from
 (select c.id,c.name,coalesce(s.name,'Frota compartilhada') as store_name,p.latitude,p.longitude,p.observed_at,p.accuracy_m
 from public.couriers c join public.courier_positions p on p.courier_id=c.id left join public.stores s on s.id=c.store_id
 where c.active and c.available and p.observed_at>=now()-interval '2 minutes' and p.observed_at<=now()
 and p.latitude between -90 and 90 and p.longitude between -180 and 180 and (p_store is null or c.store_id=p_store or public.pitacco_courier_test_access(c.id,p_store))
 order by p.observed_at desc,c.id limit 501) x;
 return jsonb_build_object('rows',j-500,'truncated',jsonb_array_length(j)>500);
end $fleet$;
create or replace function public.pitacco_owner_general_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $settings$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return (select jsonb_build_object('enforce_new_orders',enforce_new_orders,'regularization_configured',regularization_url is not null) from pitacco_private.subscription_control where singleton);
end $settings$;
revoke all on function public.pitacco_owner_store_members(uuid,integer),public.pitacco_owner_campaign_rows(uuid,integer),public.pitacco_owner_campaign_active(uuid,uuid,boolean),public.pitacco_owner_live_positions(uuid),public.pitacco_owner_general_settings() from public,anon,authenticated;
grant execute on function public.pitacco_owner_store_members(uuid,integer),public.pitacco_owner_campaign_rows(uuid,integer),public.pitacco_owner_campaign_active(uuid,uuid,boolean),public.pitacco_owner_live_positions(uuid),public.pitacco_owner_general_settings() to authenticated;
create or replace function public.pitacco_owner_set_store_member_role(p_store uuid,p_user uuid,p_role text)
returns void language plpgsql security definer set search_path='' as $member_role$
declare prior text;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_role is null or p_role not in ('gestor','lojista') then raise exception 'Função inválida' using errcode='22023';end if;
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja indisponível' using errcode='22023';end if;
 select role into prior from public.store_members where store_id=p_store and user_id=p_user for update;
 if not found then raise exception 'Vínculo indisponível' using errcode='22023';end if;
 if prior=p_role then return;end if;
 if prior='gestor' and p_role='lojista' and not exists(select 1 from public.store_members where store_id=p_store and user_id<>p_user and role='gestor') then raise exception 'A loja deve manter pelo menos um gestor' using errcode='22023';end if;
 update public.store_members set role=p_role where store_id=p_store and user_id=p_user;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'store_member_role',jsonb_build_object('user_id',p_user,'before',prior,'after',p_role));
end $member_role$;
revoke all on function public.pitacco_owner_set_store_member_role(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_owner_set_store_member_role(uuid,uuid,text) to authenticated;
create or replace function public.pitacco_owner_subscription_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo do proprietário'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',s.id,'name',s.name,'phone',s.phone,'created_at',s.created_at,
 'status',state.status,'trial_ends_at',state.trial_ends_at,'paid_until',state.paid_until,
 'plan',s.plan,'monthly_amount',sub.monthly_amount,
 'due_date',sub.due_date,'subscription_status',sub.status,
 'admin_due_date',adm.billing_due_date,'courtesy_until',adm.courtesy_until,
 'suspended',coalesce(adm.suspended,false),'notes',coalesce(adm.notes,''),
 'orders_count',(select count(*) from public.orders o where o.store_id=s.id),
 'last_order_at',(select max(o.created_at) from public.orders o where o.store_id=s.id),
 'payments',coalesce((select jsonb_agg(jsonb_build_object(
 'provider',p.provider,'amount',p.amount,'confirmed_at',p.confirmed_at,
 'paid_until',p.paid_until,'payment_id',p.provider_payment_id
 ) order by p.confirmed_at desc) from pitacco_private.subscription_payments p where p.store_id=s.id),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'actor',a.actor_id,'created_at',a.created_at,'details',a.details) order by a.created_at desc)
 from (select * from pitacco_private.subscription_admin_audit where store_id=s.id order by created_at desc limit 30) a),'[]'::jsonb)
 ) order by s.name),'[]'::jsonb) into result
 from public.stores s cross join lateral pitacco_private.subscription_state(s.id) state
 left join public.subscriptions sub on sub.store_id=s.id
 left join pitacco_private.subscription_admin_controls adm on adm.store_id=s.id;
 return result;
end;
$$;
create or replace function public.pitacco_subscription_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Acesso reservado à administração do Pitacco'; end if;
 select jsonb_build_object('registered',count(*),
 'trial',count(*) filter(where state.status='trial'),
 'active',count(*) filter(where state.status='active'),
 'courtesy',count(*) filter(where state.status='courtesy'),
 'suspended',count(*) filter(where state.status='suspended'),
 'overdue',count(*) filter(where state.status='overdue'),
 'legacy',count(*) filter(where state.status='legacy'),
 'monthly_recurring_revenue',coalesce(sum(sub.monthly_amount) filter(where state.status='active'),0),
 'active_without_registered_amount',count(*) filter(where state.status='active' and sub.monthly_amount is null))
 into result from public.stores store cross join lateral pitacco_private.subscription_state(store.id) state
 left join public.subscriptions sub on sub.store_id=store.id;
 return result;
end;
$$;

-- Separate contractual terms from the live catalog. No legacy contract is silently migrated.
create table pitacco_private.commercial_contracts(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 revision text not null references pitacco_private.plan_catalog_versions(revision),
 plan_code text not null, effective_from date not null,
 terms jsonb not null, assigned_by uuid not null, created_at timestamptz not null default now(),
 unique(store_id,effective_from)
);
alter table pitacco_private.commercial_contracts enable row level security;
revoke all on pitacco_private.commercial_contracts from public,anon,authenticated;
-- The approved request is the source of the snapshot. This records future commercial
-- terms, without changing legacy entitlement, provider payment records or store.plan.
create or replace function public.pitacco_owner_schedule_commercial_contract(p_request uuid,p_effective date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $contract$
declare r pitacco_private.plan_change_requests%rowtype; offer jsonb; result uuid; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_effective is null or p_effective<today or p_effective>today+366 or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Vigência ou justificativa inválida' using errcode='22023';end if;
 select * into r from pitacco_private.plan_change_requests where id=p_request;
 if not found then raise exception 'Solicitação indisponível' using errcode='22023';end if;
 perform 1 from public.stores where id=r.store_id for update;
 select * into r from pitacco_private.plan_change_requests where id=p_request for update;
 if r.status not in ('pending','in_review') then raise exception 'Solicitação indisponível' using errcode='22023';end if;
 select p into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) p where v.revision=r.terms_version and p->>'code'=r.requested_plan;
 if offer is null then raise exception 'Condições indisponíveis' using errcode='22023';end if;
 if exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=r.store_id) then raise exception 'Já existe contrato comercial; alteração de vigência requer conciliação dos ciclos' using errcode='22023';end if;
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by) values(r.store_id,r.terms_version,r.requested_plan,p_effective,offer,auth.uid()) returning id into result;
 update pitacco_private.plan_change_requests set status='approved',updated_at=now(),decided_by=auth.uid(),decision_note=btrim(p_reason) where id=r.id;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(r.store_id,auth.uid(),'commercial_contract_scheduled',jsonb_build_object('contract_id',result,'request_id',r.id,'effective_from',p_effective,'reason',p_reason,'terms',offer));
 return result;
end $contract$;
alter table pitacco_private.plan_change_requests drop constraint plan_change_requests_status_check;
alter table pitacco_private.plan_change_requests add constraint plan_change_catalog_status_check check(status in ('pending','in_review','cancelled','declined','approved'));
-- Compute the eligible product base only from explicit server-calculated subtotal
-- and discount; never substitute gross, which includes freight. Missing or
-- ambiguous adjustments block a final amount and require reconciliation.
create or replace function pitacco_private.commission_product_base(p_receipt jsonb)
returns bigint language plpgsql immutable set search_path='' as $base$
declare subtotal numeric; discount numeric;
begin
 if jsonb_typeof(p_receipt) is distinct from 'object' or
 coalesce(p_receipt->>'subtotal','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' or
 coalesce(p_receipt->>'discount','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then return null;end if;
 if p_receipt ?| array['refund','refunds','refunded_amount','cancelled_items','partial_refund','refunded_product_cents','cancelled_product_cents'] then return null;end if;
 if lower(coalesce(p_receipt->>'payment_status','')) in ('refunded','partially_refunded','estornado','estorno_parcial') then return null;end if;
 subtotal:=(p_receipt->>'subtotal')::numeric;discount:=(p_receipt->>'discount')::numeric;
 if discount>subtotal then return null;end if;
 return round((subtotal-discount)*100)::bigint;
end $base$;
revoke all on function pitacco_private.commission_product_base(jsonb) from public,anon,authenticated;
create or replace function public.pitacco_commercial_amount_preview(p_store uuid,p_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $amount$
declare c pitacco_private.commercial_contracts%rowtype; today date:=(now() at time zone 'America/Sao_Paulo')::date;
 day date:=coalesce(p_day,today); period_start date; period_end date; due_at timestamptz;
 base bigint:=0; unknown bigint:=0; count_orders bigint:=0; rate integer; monthly bigint; commission bigint; trial_end date; monthly_start date; monthly_due date; monthly_charge bigint;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.is_store_manager(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 if day>today or day<'2000-01-01' then raise exception 'Data inválida' using errcode='22023';end if;
 select * into c from pitacco_private.commercial_contracts where store_id=p_store and effective_from<=day order by effective_from desc limit 1;
 if not found then return jsonb_build_object('status','unassigned','message','Nenhum contrato comercial vigente no novo catálogo.');end if;
 rate:=(c.terms->>'commission_basis_points')::integer;monthly:=(c.terms->>'monthly_cents')::bigint;
 trial_end:=c.effective_from+(c.terms->>'trial_days')::integer;
 if c.terms->>'billing_cycle'='weekly' then
  period_start:=day-((extract(isodow from day)::integer+4)%7);
  period_end:=period_start+7;
 else
  period_start:=date_trunc('month',day::timestamp)::date;
  period_end:=(period_start+interval '1 month')::date;
 end if;
 due_at:=(period_end+time '23:59') at time zone 'America/Sao_Paulo';
 if rate>0 then
  with eligible as (
   select pitacco_private.commission_product_base(o.receipt) as cents
   from public.orders o where o.store_id=p_store and o.source='proprio' and o.status='accepted'
   and o.created_at>=greatest(period_start,c.effective_from,trial_end)::timestamp at time zone 'America/Sao_Paulo'
   and o.created_at<period_end::timestamp at time zone 'America/Sao_Paulo' and o.created_at<=now()
   and coalesce(o.receipt->>'is_test','false')='false' and coalesce(o.receipt->>'test','false')='false' and coalesce(o.receipt->>'ifood_test','false')='false'
   and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='cancelada')
   and (o.preparation_status='completed' or exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='entregue'))
  ) select coalesce(sum(cents),0),count(*) filter(where cents is null),count(*) into base,unknown,count_orders from eligible;
 end if;
 commission:=round(base::numeric*rate/10000)::bigint;
 -- Monthly recurring price is separate from the commission cycle; never divide
 -- the monthly fee into weekly charges. First renewal follows the trial.
 monthly_start:=greatest(date_trunc('month',day::timestamp)::date,trial_end);
 monthly_due:=(date_trunc('month',day::timestamp)+interval '1 month')::date;
 monthly_charge:=case when trial_end>=monthly_due then 0 else monthly end;
 return jsonb_build_object('status',case when unknown>0 then 'review_required' when day<trial_end then 'trial' else 'calculated' end,
 'plan_name',c.terms->>'name','revision',c.revision,'period_start',period_start,'period_end_exclusive',period_end,'due_at',due_at,'grace_until',due_at+interval '48 hours',
 'base_cents',base,'eligible_orders',count_orders,'unresolved_orders',unknown,'commission_basis_points',rate,'commission_cents',case when unknown=0 then commission else null end,
 'monthly_cents',monthly_charge,'monthly_period_start',monthly_start,'monthly_due_at',(monthly_due+time '23:59') at time zone 'America/Sao_Paulo',
 'trial_end',trial_end,'calculation_only',true);
end $amount$;
revoke all on function public.pitacco_owner_schedule_commercial_contract(uuid,date,text),public.pitacco_commercial_amount_preview(uuid,date) from public,anon,authenticated;
grant execute on function public.pitacco_owner_schedule_commercial_contract(uuid,date,text),public.pitacco_commercial_amount_preview(uuid,date) to authenticated;
notify pgrst,'reload schema';
