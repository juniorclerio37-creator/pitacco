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
notify pgrst,'reload schema';
