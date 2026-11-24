set local lock_timeout='3s';
-- Migration candidate: validate in isolated PostgreSQL before generating/deploying the official migration.
-- Commercial offer catalog only; existing contracts and Asaas are not mutated.
create table pitacco_private.plan_catalog_versions(
 revision text primary key, plans jsonb not null, changed_by uuid, created_at timestamptz not null default now()
);
alter table pitacco_private.plan_catalog_versions enable row level security;
revoke all on pitacco_private.plan_catalog_versions from public,anon,authenticated;
insert into pitacco_private.plan_catalog_versions(revision,plans) values('2026-11-24-v1',
 '[{"code":"free","name":"Grátis para sempre","monthly_cents":0,"commission_basis_points":500,"billing_cycle":"weekly","trial_days":0,"grace_hours":48,"due_iso_weekday":3,"monthly_due_day":1,"available":true,"description":"Módulos essenciais. Comissão sobre produtos e complementos dos pedidos próprios, excluídos frete, descontos e cancelamentos."},{"code":"complete","name":"Completo","monthly_cents":5990,"commission_basis_points":0,"billing_cycle":"monthly","trial_days":30,"grace_hours":48,"due_iso_weekday":3,"monthly_due_day":1,"available":true,"description":"Pedidos ilimitados e acesso aos módulos do plano."}]');
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
declare old_revision text; new_revision text; plan jsonb; checked jsonb:='[]'::jsonb; code text; amount integer; commission integer; trial integer; title text; description text; available boolean; cycle text; grace integer; weekday integer; monthly_day integer;
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
  if coalesce(plan->>'grace_hours','48') !~ '^[0-9]{1,3}$' or coalesce(plan->>'due_iso_weekday','3') !~ '^[1-7]$' or coalesce(plan->>'monthly_due_day','1') !~ '^[0-9]{1,2}$' then raise exception 'Prazo ou vencimento inválido' using errcode='22023';end if;
  grace:=coalesce((plan->>'grace_hours')::integer,48);weekday:=3;monthly_day:=1;
  if grace>720 or monthly_day not between 1 and 28 then raise exception 'Prazo ou vencimento inválido' using errcode='22023';end if;
  amount:=(plan->>'monthly_cents')::integer; commission:=(plan->>'commission_basis_points')::integer; trial:=(plan->>'trial_days')::integer;
  if commission>10000 or trial>365 then raise exception 'Limites inválidos' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(checked) p where p->>'code'=code) then raise exception 'Plano duplicado' using errcode='22023';end if;
  checked:=checked||jsonb_build_array(jsonb_build_object('code',code,'name',title,'monthly_cents',amount,'commission_basis_points',commission,'trial_days',trial,'description',description,'available',available,'billing_cycle',cycle,'grace_hours',grace,'due_iso_weekday',weekday,'monthly_due_rule','registration_plus_30_anniversary'));
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
-- First due date: registration + 30 local calendar days. Subsequent dates
-- retain the resulting day of month, clamped only for shorter months.
create or replace function pitacco_private.monthly_due_on_or_after(p_anchor date,p_min date)
returns date language plpgsql immutable strict set search_path='' as $anniversary$
declare month_start date; candidate date; anchor_day integer;
begin
 if p_min<=p_anchor then return p_anchor;end if;
 anchor_day:=extract(day from p_anchor)::integer;
 month_start:=date_trunc('month',p_min::timestamp)::date;
 candidate:=least(month_start+anchor_day-1,(month_start+interval '1 month')::date-1);
 if candidate<p_min then
  month_start:=(month_start+interval '1 month')::date;
  candidate:=least(month_start+anchor_day-1,(month_start+interval '1 month')::date-1);
 end if;
 return greatest(candidate,p_anchor);
end $anniversary$;
revoke all on function pitacco_private.monthly_due_on_or_after(date,date) from public,anon,authenticated;
create or replace function pitacco_private.commercial_amount_calculate(p_store uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $amount$
declare c pitacco_private.commercial_contracts%rowtype; today date:=(now() at time zone 'America/Sao_Paulo')::date;
 day date:=coalesce(p_day,today); period_start date; period_end date; due_at timestamptz;
 base bigint:=0; unknown bigint:=0; count_orders bigint:=0; rate integer; monthly bigint; commission bigint; trial_end date; monthly_start date; monthly_due date; monthly_charge bigint; weekday integer; grace integer; monthly_day integer; unfinished bigint:=0; registration date; anchor date; first_due date; previous_month date;
begin
 if day>today or day<'2000-01-01' then raise exception 'Data inválida' using errcode='22023';end if;
 select * into c from pitacco_private.commercial_contracts where store_id=p_store and effective_from<=day order by effective_from desc limit 1;
 if not found then return jsonb_build_object('status','unassigned','message','Nenhum contrato comercial vigente no novo catálogo.');end if;
 rate:=(c.terms->>'commission_basis_points')::integer;monthly:=(c.terms->>'monthly_cents')::bigint;
 trial_end:=c.effective_from+(c.terms->>'trial_days')::integer;
 weekday:=3;grace:=coalesce((c.terms->>'grace_hours')::integer,48);
 select (s.created_at at time zone 'America/Sao_Paulo')::date into registration from public.stores s where s.id=p_store;
 anchor:=registration+30;
 -- Every commission, including hybrid plans, closes Wednesday.
 period_start:=day-((extract(isodow from day)::integer-3+7)%7);
 period_end:=period_start+7;
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
  select count(*) into unfinished from public.orders o where o.store_id=p_store and o.source='proprio' and o.status in ('pending','accepted')
   and o.created_at>=greatest(period_start,c.effective_from,trial_end)::timestamp at time zone 'America/Sao_Paulo'
   and o.created_at<period_end::timestamp at time zone 'America/Sao_Paulo' and o.created_at<=now()
   and coalesce(o.receipt->>'is_test','false')='false' and coalesce(o.receipt->>'test','false')='false' and coalesce(o.receipt->>'ifood_test','false')='false'
   and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status in ('cancelada','entregue'))
   and coalesce(o.preparation_status,'')<>'completed';
 end if;
 commission:=round(base::numeric*rate/10000)::bigint;
 -- Monthly recurring price is separate from the commission cycle; never divide
 -- the monthly fee into weekly charges. First renewal follows the trial.
 first_due:=pitacco_private.monthly_due_on_or_after(anchor,greatest(anchor,c.effective_from+1,trial_end));
 monthly_due:=pitacco_private.monthly_due_on_or_after(anchor,greatest(first_due,day));
 previous_month:=(date_trunc('month',monthly_due::timestamp)-interval '1 month')::date;
 monthly_start:=case when monthly_due=first_due then c.effective_from else greatest(c.effective_from,least(previous_month+extract(day from anchor)::integer-1,(previous_month+interval '1 month')::date-1)) end;
 monthly_charge:=monthly;
 return jsonb_build_object('status',case when unknown>0 then 'review_required' when day<trial_end then 'trial' else 'calculated' end,
 'plan_name',c.terms->>'name','revision',c.revision,'period_start',period_start,'period_end_exclusive',period_end,'due_at',due_at,'grace_until',due_at+make_interval(hours=>grace),
 'base_cents',base,'eligible_orders',count_orders,'unresolved_orders',unknown,'unfinished_orders',unfinished,'commission_basis_points',rate,'commission_cents',case when unknown=0 then commission else null end,
 'monthly_cents',monthly_charge,'monthly_period_start',monthly_start,'monthly_period_end_exclusive',monthly_due,'monthly_due_at',(monthly_due+time '23:59') at time zone 'America/Sao_Paulo','monthly_grace_until',((monthly_due+time '23:59') at time zone 'America/Sao_Paulo')+make_interval(hours=>grace),'registration_date',registration,'first_monthly_due',first_due,'monthly_anchor',anchor,
 'trial_end',trial_end,'calculation_only',true);
end $amount$;
revoke all on function pitacco_private.commercial_amount_calculate(uuid,date) from public,anon,authenticated;
create or replace function public.pitacco_commercial_amount_preview(p_store uuid,p_day date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $preview$
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.is_store_manager(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 return pitacco_private.commercial_amount_calculate(p_store,coalesce(p_day,(now() at time zone 'America/Sao_Paulo')::date));
end $preview$;
revoke all on function public.pitacco_owner_schedule_commercial_contract(uuid,date,text),public.pitacco_commercial_amount_preview(uuid,date) from public,anon,authenticated;
grant execute on function public.pitacco_owner_schedule_commercial_contract(uuid,date,text),public.pitacco_commercial_amount_preview(uuid,date) to authenticated;
-- Persist recalculable closing statements, not payment confirmations.
-- No financial obligation or automatic suspension is activated by a draft.
create table pitacco_private.commercial_closings(
 contract_id uuid not null references pitacco_private.commercial_contracts(id),
 store_id uuid not null references public.stores(id),
 kind text not null check(kind in ('monthly','commission')),
 period_start date not null, period_end date not null check(period_end>period_start),
 due_at timestamptz not null, grace_until timestamptz not null,
 amount_cents bigint check(amount_cents>=0),
 state text not null check(state in ('calculated','review_required')),
 details jsonb not null, updated_at timestamptz not null default now(),
 primary key(contract_id,kind,period_end)
);
alter table pitacco_private.commercial_closings enable row level security;
revoke all on pitacco_private.commercial_closings from public,anon,authenticated;
create or replace function pitacco_private.refresh_commercial_closings()
returns integer language plpgsql security definer set search_path='' as $closing$
declare c pitacco_private.commercial_contracts%rowtype; d date; r jsonb; today date:=(now() at time zone 'America/Sao_Paulo')::date; n integer:=0; st date; en date; value bigint; problem boolean; k text;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('pitacco-commercial-closing-v1',0)) then return 0;end if;
 for c in select * from pitacco_private.commercial_contracts where effective_from<today order by store_id loop
  -- Each cycle is refreshed once using its last local date. Re-runs update
  -- the same record, including late completion/cancellation, never duplicate it.
  for d in select day::date from generate_series(c.effective_from::timestamp,(today-1)::timestamp,interval '1 day') g(day)
   where (extract(isodow from day+interval '1 day')::integer=3 and (c.terms->>'commission_basis_points')::integer>0)
      or ((c.terms->>'monthly_cents')::bigint>0 and (day+interval '1 day')::date=pitacco_private.monthly_due_on_or_after((select (s.created_at at time zone 'America/Sao_Paulo')::date+30 from public.stores s where s.id=c.store_id),(day+interval '1 day')::date)) loop
   r:=pitacco_private.commercial_amount_calculate(c.store_id,d);
   if r->>'revision' is distinct from c.revision then continue;end if;
   foreach k in array array['commission','monthly'] loop
    if k='commission' then
     if (c.terms->>'commission_basis_points')::integer=0 then continue;end if;
     en:=(r->>'period_end_exclusive')::date;
     if en<>d+1 then continue;end if;
     st:=greatest((r->>'period_start')::date,c.effective_from,(r->>'trial_end')::date);
     problem:=(r->>'unresolved_orders')::bigint>0 or (r->>'unfinished_orders')::bigint>0;
     value:=case when problem then null else (r->>'commission_cents')::bigint end;
    else
     if (c.terms->>'monthly_cents')::bigint=0 then continue;end if;
     en:=(r->>'monthly_period_end_exclusive')::date;
     if en<>d+1 then continue;end if;
     st:=(r->>'monthly_period_start')::date;
     problem:=false;value:=(r->>'monthly_cents')::bigint;
    end if;
    if st>=en or en>today then continue;end if;
    insert into pitacco_private.commercial_closings(contract_id,store_id,kind,period_start,period_end,due_at,grace_until,amount_cents,state,details)
    values(c.id,c.store_id,k,st,en,
     (case when k='commission' then r->>'due_at' else r->>'monthly_due_at' end)::timestamptz,
     (case when k='commission' then r->>'grace_until' else r->>'monthly_grace_until' end)::timestamptz,
     value,case when problem then 'review_required' else 'calculated' end,r)
    on conflict(contract_id,kind,period_end) do update set amount_cents=excluded.amount_cents,state=excluded.state,details=excluded.details,updated_at=now()
    where (commercial_closings.amount_cents,commercial_closings.state,commercial_closings.details) is distinct from (excluded.amount_cents,excluded.state,excluded.details);
    n:=n+1;
   end loop;
  end loop;
 end loop;
 return n;
end $closing$;
revoke all on function pitacco_private.refresh_commercial_closings() from public,anon,authenticated;
create or replace function public.pitacco_owner_refresh_commercial_closings()
returns integer language plpgsql security definer set search_path='' as $closing_owner$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return pitacco_private.refresh_commercial_closings();
end $closing_owner$;
create or replace function public.pitacco_commercial_closings(p_store uuid,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $closing_read$
declare j jsonb;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or (p_store is not null and public.is_store_manager(p_store))) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Página inválida' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.period_end desc,x.contract_id,x.kind),'[]'::jsonb) into j from
 (select b.contract_id,b.store_id,s.name as store_name,b.kind,b.period_start,b.period_end,b.due_at,b.grace_until,b.amount_cents,b.state,b.updated_at from pitacco_private.commercial_closings b join public.stores s on s.id=b.store_id where p_store is null or b.store_id=p_store order by b.period_end desc,b.contract_id,b.kind offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25,'draft_only',true);
end $closing_read$;
revoke all on function public.pitacco_owner_refresh_commercial_closings(),public.pitacco_commercial_closings(uuid,integer) from public,anon,authenticated;
grant execute on function public.pitacco_owner_refresh_commercial_closings(),public.pitacco_commercial_closings(uuid,integer) to authenticated;

-- A payable invoice is a frozen record. Recalculated statements never rewrite it.
create table pitacco_private.commercial_invoices(
 id uuid primary key default gen_random_uuid(),contract_id uuid not null,kind text not null,period_end date not null,
 amount_cents bigint not null check(amount_cents>0),due_at timestamptz not null,grace_until timestamptz not null,
 created_at timestamptz not null default now(),
 unique(contract_id,kind,period_end),
 foreign key(contract_id,kind,period_end) references pitacco_private.commercial_closings(contract_id,kind,period_end)
);
create table pitacco_private.commercial_manual_payments(
 invoice_id uuid primary key references pitacco_private.commercial_invoices(id),
 amount_cents bigint not null check(amount_cents>0),
 reference text not null unique check(length(reference) between 5 and 160),
 verified_by uuid not null, verified_at timestamptz not null default now(),
 note text not null check(length(note) between 5 and 500)
);
alter table pitacco_private.commercial_invoices enable row level security;
alter table pitacco_private.commercial_manual_payments enable row level security;
revoke all on pitacco_private.commercial_invoices,pitacco_private.commercial_manual_payments from public,anon,authenticated;
create or replace function pitacco_private.issue_commercial_invoices()
returns integer language plpgsql security definer set search_path='' as $invoice$
declare n integer;
begin
 insert into pitacco_private.commercial_invoices(contract_id,kind,period_end,amount_cents,due_at,grace_until)
 select contract_id,kind,period_end,amount_cents,due_at,grace_until from pitacco_private.commercial_closings
 where state='calculated' and amount_cents>0 and period_end<=(now() at time zone 'America/Sao_Paulo')::date
 on conflict(contract_id,kind,period_end) do nothing;
 get diagnostics n=row_count;
 return n;
end $invoice$;
revoke all on function pitacco_private.issue_commercial_invoices() from public,anon,authenticated;
create or replace function pitacco_private.run_commercial_billing()
returns integer language plpgsql security definer set search_path='' as $invoice$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('pitacco-commercial-closing-v1',0)) then return 0;end if;
 perform pitacco_private.refresh_commercial_closings();
 return pitacco_private.issue_commercial_invoices();
end $invoice$;
revoke all on function pitacco_private.run_commercial_billing() from public,anon,authenticated;
create or replace function public.pitacco_owner_refresh_commercial_closings()
returns integer language plpgsql security definer set search_path='' as $invoice$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return pitacco_private.run_commercial_billing();
end $invoice$;
create or replace function pitacco_private.commercial_invoice_status(p_amount bigint,p_calculated bigint,p_state text,p_paid boolean,p_due timestamptz,p_grace timestamptz)
returns text language sql stable set search_path='' as $invoice$
 select case when p_state is distinct from 'calculated' or p_amount is distinct from p_calculated then 'review_required'
 when p_paid then 'paid' when now()>p_grace then 'overdue' when now()>p_due then 'grace' else 'open' end
$invoice$;
revoke all on function pitacco_private.commercial_invoice_status(bigint,bigint,text,boolean,timestamptz,timestamptz) from public,anon,authenticated;
create or replace function public.pitacco_commercial_invoices(p_store uuid,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $invoice$
declare j jsonb;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or (p_store is not null and public.is_store_manager(p_store))) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Página inválida' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at desc,x.id),'[]'::jsonb) into j from (
 select i.id,b.store_id,s.name as store_name,i.kind,b.period_start,i.period_end,i.amount_cents,i.due_at,i.grace_until,
 pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until) as status,
 p.verified_at as paid_at
 from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 join public.stores s on s.id=b.store_id left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 where p_store is null or b.store_id=p_store order by i.due_at desc,i.id offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25);
end $invoice$;
create or replace function public.pitacco_owner_confirm_commercial_payment(p_invoice uuid,p_amount_cents bigint,p_reference text,p_note text)
returns void language plpgsql security definer set search_path='' as $invoice$
declare i pitacco_private.commercial_invoices%rowtype; b pitacco_private.commercial_closings%rowtype; existing pitacco_private.commercial_manual_payments%rowtype;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if length(btrim(coalesce(p_reference,''))) not between 5 and 160 or length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe referência e justificativa da conferência' using errcode='22023';end if;
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found or p_amount_cents is distinct from i.amount_cents then raise exception 'Valor ou cobrança inválidos' using errcode='22023';end if;
 select * into existing from pitacco_private.commercial_manual_payments where invoice_id=i.id;
 if found then
  if existing.reference=btrim(p_reference) and existing.amount_cents=p_amount_cents then return;end if;
  raise exception 'Cobrança já liquidada' using errcode='22023';
 end if;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end for share;
 if b.state is distinct from 'calculated' or b.amount_cents is distinct from i.amount_cents then raise exception 'Concilie a divergência antes de confirmar' using errcode='22023';end if;
 insert into pitacco_private.commercial_manual_payments(invoice_id,amount_cents,reference,verified_by,note)
 values(i.id,p_amount_cents,btrim(p_reference),auth.uid(),btrim(p_note));
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(b.store_id,auth.uid(),'commercial_payment_manually_verified',jsonb_build_object('invoice_id',i.id,'amount_cents',p_amount_cents,'reference',btrim(p_reference),'reason',btrim(p_note)));
end $invoice$;
revoke all on function public.pitacco_commercial_invoices(uuid,integer),public.pitacco_owner_confirm_commercial_payment(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_commercial_invoices(uuid,integer),public.pitacco_owner_confirm_commercial_payment(uuid,bigint,text,text) to authenticated;

-- Explicit rollout gate: no new commercial block before a real regularization channel is available.
create table pitacco_private.commercial_billing_control(
 singleton boolean primary key default true check(singleton),
 enforce_own_orders boolean not null default false,
 payment_instructions text check(length(payment_instructions) between 10 and 1000),
 updated_at timestamptz not null default now(),updated_by uuid,
 check(not enforce_own_orders or payment_instructions is not null)
);
insert into pitacco_private.commercial_billing_control(singleton) values(true);
alter table pitacco_private.commercial_billing_control enable row level security;
revoke all on pitacco_private.commercial_billing_control from public,anon,authenticated;
create or replace function pitacco_private.commercial_orders_blocked(p_store uuid)
returns boolean language sql stable security definer set search_path='' as $gate$
 select exists(select 1 from pitacco_private.commercial_billing_control where singleton and enforce_own_orders)
 and exists(select 1 from pitacco_private.commercial_invoices i
 join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 where b.store_id=p_store and pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until)='overdue')
 and not exists(select 1 from pitacco_private.subscription_admin_controls a where a.store_id=p_store and a.courtesy_until>now())
$gate$;
revoke all on function pitacco_private.commercial_orders_blocked(uuid) from public,anon,authenticated;
create or replace function pitacco_private.enforce_commercial_order()
returns trigger language plpgsql security definer set search_path='' as $gate$
begin
 if new.status is distinct from 'historical'
 and pitacco_private.commercial_orders_blocked(new.store_id) then
  raise exception 'Estabelecimento bloqueado por inadimplência. Regularize as cobranças na área de assinaturas do Pitacco.' using errcode='P0001';
 end if;
 return new;
end $gate$;
revoke all on function pitacco_private.enforce_commercial_order() from public,anon,authenticated;
create trigger pitacco_commercial_order_guard before insert on public.orders for each row execute function pitacco_private.enforce_commercial_order();
create or replace function public.pitacco_owner_commercial_billing_control()
returns jsonb language plpgsql stable security definer set search_path='' as $gate$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return (select to_jsonb(c)-'singleton' from pitacco_private.commercial_billing_control c where singleton);
end $gate$;
create or replace function public.pitacco_owner_set_commercial_billing_control(p_enforce boolean,p_instructions text)
returns void language plpgsql security definer set search_path='' as $gate$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_enforce is null or length(btrim(coalesce(p_instructions,'')))>1000 or (p_enforce and length(btrim(coalesce(p_instructions,'')))<10) then raise exception 'Informe um canal de regularização válido antes de ativar' using errcode='22023';end if;
 update pitacco_private.commercial_billing_control set enforce_own_orders=p_enforce,payment_instructions=case when length(btrim(coalesce(p_instructions,'')))>=10 then btrim(p_instructions) else null end,updated_at=now(),updated_by=auth.uid() where singleton;
end $gate$;
create or replace function public.pitacco_merchant_commercial_billing_state(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $gate$
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.is_store_manager(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 return (select jsonb_build_object('own_orders_blocked',pitacco_private.commercial_orders_blocked(p_store),'payment_instructions',payment_instructions) from pitacco_private.commercial_billing_control where singleton);
end $gate$;
revoke all on function public.pitacco_owner_commercial_billing_control(),public.pitacco_owner_set_commercial_billing_control(boolean,text),public.pitacco_merchant_commercial_billing_state(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_commercial_billing_control(),public.pitacco_owner_set_commercial_billing_control(boolean,text),public.pitacco_merchant_commercial_billing_state(uuid) to authenticated;

-- Native regularization screen: PIX is configured by the platform owner.
-- A submitted document is evidence, never a payment confirmation.
alter table pitacco_private.commercial_billing_control
 add column pix_cnpj text check(pix_cnpj is null or pix_cnpj ~ '^[0-9]{14}$'),
 add column pix_recipient text check(pix_recipient is null or length(pix_recipient) between 2 and 120);
create table pitacco_private.commercial_payment_claims(
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references pitacco_private.commercial_invoices(id),
 submitted_by uuid not null,reference text not null check(length(reference) between 5 and 160),
 mime text not null check(mime in ('application/pdf','image/jpeg','image/png')),
 proof bytea not null check(octet_length(proof) between 8 and 2097152),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid,review_note text
);
create unique index commercial_one_pending_claim on pitacco_private.commercial_payment_claims(invoice_id) where status='pending';
alter table pitacco_private.commercial_payment_claims enable row level security;
revoke all on pitacco_private.commercial_payment_claims from public,anon,authenticated;
create or replace function public.pitacco_owner_set_commercial_pix(p_cnpj text,p_recipient text)
returns void language plpgsql security definer set search_path='' as $pix$
declare k text:=regexp_replace(coalesce(p_cnpj,''),'[^0-9]','','g');
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if k !~ '^[0-9]{14}$' or length(btrim(coalesce(p_recipient,''))) not between 2 and 120 then raise exception 'Informe a chave CNPJ e o favorecido' using errcode='22023';end if;
 update pitacco_private.commercial_billing_control set pix_cnpj=k,pix_recipient=btrim(p_recipient),updated_at=now(),updated_by=auth.uid() where singleton;
end $pix$;
create or replace function public.pitacco_merchant_commercial_billing_state(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $pix$
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or public.is_store_manager(p_store)) then raise exception 'Sem permissão' using errcode='42501';end if;
 return (select jsonb_build_object('own_orders_blocked',pitacco_private.commercial_orders_blocked(p_store),'payment_instructions',payment_instructions,'pix_cnpj',pix_cnpj,'pix_recipient',pix_recipient) from pitacco_private.commercial_billing_control where singleton);
end $pix$;
create or replace function public.pitacco_submit_commercial_payment(p_invoice uuid,p_reference text,p_mime text,p_proof text)
returns uuid language plpgsql security definer set search_path='' as $claim$
declare i pitacco_private.commercial_invoices%rowtype;b pitacco_private.commercial_closings%rowtype;data bytea;result uuid;
begin
 if auth.uid() is null then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end;
 if b.store_id is null or not public.is_store_manager(b.store_id) then raise exception 'Sem permissão' using errcode='42501';end if;
 if not exists(select 1 from pitacco_private.commercial_billing_control where pix_cnpj is not null and pix_recipient is not null) then raise exception 'Pix ainda não configurado' using errcode='22023';end if;
 if b.state<>'calculated' or i.amount_cents is distinct from b.amount_cents or exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) then raise exception 'Cobrança indisponível para pagamento' using errcode='22023';end if;
 if length(btrim(coalesce(p_reference,''))) not between 5 and 160 or p_mime is null or p_mime not in ('application/pdf','image/jpeg','image/png') or length(coalesce(p_proof,'')) not between 12 and 2796204 then raise exception 'Comprovante inválido ou maior que 2 MB' using errcode='22023';end if;
 data:=decode(p_proof,'base64');
 if octet_length(data) not between 8 and 2097152 or
 (p_mime='application/pdf' and substring(data from 1 for 5)<>decode('255044462d','hex')) or
 (p_mime='image/jpeg' and substring(data from 1 for 3)<>decode('ffd8ff','hex')) or
 (p_mime='image/png' and substring(data from 1 for 8)<>decode('89504e470d0a1a0a','hex')) then raise exception 'Formato do comprovante inválido' using errcode='22023';end if;
 insert into pitacco_private.commercial_payment_claims(invoice_id,submitted_by,reference,mime,proof)
 values(i.id,auth.uid(),btrim(p_reference),p_mime,data) returning id into result;
 return result;
end $claim$;
create or replace function public.pitacco_owner_commercial_payment_proof(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $claim$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return (select jsonb_build_object('mime',mime,'base64',encode(proof,'base64')) from pitacco_private.commercial_payment_claims where id=p_claim);
end $claim$;
create or replace function public.pitacco_owner_review_commercial_payment(p_claim uuid,p_approve boolean,p_note text)
returns void language plpgsql security definer set search_path='' as $claim$
declare c pitacco_private.commercial_payment_claims%rowtype;i pitacco_private.commercial_invoices%rowtype;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_approve is null or length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe a justificativa' using errcode='22023';end if;
 select * into c from pitacco_private.commercial_payment_claims where id=p_claim;
 if not found then raise exception 'Comprovante indisponível' using errcode='22023';end if;
 select * into i from pitacco_private.commercial_invoices where id=c.invoice_id for update;
 select * into c from pitacco_private.commercial_payment_claims where id=p_claim for update;
 if c.status<>'pending' then raise exception 'Comprovante já analisado' using errcode='22023';end if;
 if p_approve then perform public.pitacco_owner_confirm_commercial_payment(i.id,i.amount_cents,c.reference,p_note);end if;
 update pitacco_private.commercial_payment_claims set status=case when p_approve then 'approved' else 'rejected' end,reviewed_at=now(),reviewed_by=auth.uid(),review_note=btrim(p_note) where id=c.id;
end $claim$;
revoke all on function public.pitacco_owner_set_commercial_pix(text,text),public.pitacco_submit_commercial_payment(uuid,text,text,text),public.pitacco_owner_commercial_payment_proof(uuid),public.pitacco_owner_review_commercial_payment(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.pitacco_owner_set_commercial_pix(text,text),public.pitacco_submit_commercial_payment(uuid,text,text,text),public.pitacco_owner_commercial_payment_proof(uuid),public.pitacco_owner_review_commercial_payment(uuid,boolean,text) to authenticated;
create or replace function public.pitacco_commercial_invoices(p_store uuid,p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $invoice$
declare j jsonb;
begin
 if auth.uid() is null or not (public.pitacco_is_platform_owner() or (p_store is not null and public.is_store_manager(p_store))) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_page is null or p_page not between 0 and 100000 then raise exception 'Página inválida' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at desc,x.id),'[]'::jsonb) into j from (
 select i.id,b.store_id,s.name as store_name,i.kind,b.period_start,i.period_end,i.amount_cents,i.due_at,i.grace_until,
 pitacco_private.commercial_invoice_status(i.amount_cents,b.amount_cents,b.state,p.invoice_id is not null,i.due_at,i.grace_until) as status,
 p.verified_at as paid_at,claim.id as claim_id,claim.status as claim_status,claim.review_note,case when public.pitacco_is_platform_owner() then claim.reference else null end as claim_reference
 from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 join public.stores s on s.id=b.store_id left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id
 left join lateral (select id,status,review_note,reference from pitacco_private.commercial_payment_claims where invoice_id=i.id order by created_at desc,id desc limit 1) claim on true
 where p_store is null or b.store_id=p_store order by i.due_at desc,i.id offset p_page*25 limit 26) x;
 return jsonb_build_object('rows',j-25,'has_more',jsonb_array_length(j)>25);
end $invoice$;

-- A server-side clock determines the stage; browser clocks never determine delinquency.
create or replace function pitacco_private.commercial_notice_stage(p_now timestamptz,p_due timestamptz,p_grace timestamptz)
returns text language sql immutable strict set search_path='' as $notice$
 select case when p_now>p_grace then 'overdue'
 when p_now>p_due then 'grace'
 when (p_now at time zone 'America/Sao_Paulo')::date=(p_due at time zone 'America/Sao_Paulo')::date then 'due_today'
 else 'none' end
$notice$;
revoke all on function pitacco_private.commercial_notice_stage(timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
-- Authorized employees see the operational warning, not private invoice or payment amounts.
create or replace function public.pitacco_store_commercial_block_status(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $block_status$
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
 where b.store_id=p_store and p.invoice_id is null and b.state='calculated' and b.amount_cents=i.amount_cents
 ), relevant as (select * from unpaid where stage<>'none'), ranked as (
 select * from relevant order by case stage when 'overdue' then 1 when 'grace' then 2 else 3 end,grace_until,due_at limit 1
 )
 select (select r.stage from ranked r),(select r.due_at from ranked r),(select r.grace_until from ranked r),
 count(*) filter(where awaiting_review),count(*) filter(where not awaiting_review),count(*)
 into v_stage,due_time,grace_time,pending_count,action_count,total_count from relevant;
 return jsonb_build_object('orders_blocked',blocked,'notice_stage',case when blocked then 'blocked' else coalesce(v_stage,'none') end,
 'due_at',due_time,'grace_until',grace_time,'awaiting_review',pending_count,'payment_required',action_count,'unpaid_count',total_count);
end $block_status$;
revoke all on function public.pitacco_store_commercial_block_status(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_commercial_block_status(uuid) to authenticated;
notify pgrst,'reload schema';
