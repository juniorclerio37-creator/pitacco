-- Migration candidate: validate in isolated PostgreSQL before generating/deploying the official migration.
-- Commercial offer catalog only; existing contracts and Asaas are not mutated.
create table pitacco_private.plan_catalog_versions(
 revision text primary key, plans jsonb not null, changed_by uuid, created_at timestamptz not null default now()
);
alter table pitacco_private.plan_catalog_versions enable row level security;
revoke all on pitacco_private.plan_catalog_versions from public,anon,authenticated;
insert into pitacco_private.plan_catalog_versions(revision,plans) values('2026-11-24-v1',
 '[{"code":"free","name":"Grátis para sempre","monthly_cents":0,"commission_basis_points":500,"billing_cycle":"weekly","trial_days":0},{"code":"complete","name":"Completo","monthly_cents":5990,"commission_basis_points":0,"billing_cycle":"monthly","trial_days":30}]');
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
declare old_revision text; new_revision text; plan jsonb; checked jsonb:='[]'::jsonb; code text; amount integer; commission integer; trial integer; title text;
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if jsonb_typeof(p_plans) is distinct from 'array' then raise exception 'Catálogo inválido' using errcode='22023';end if;
 if jsonb_array_length(p_plans)<>2 then raise exception 'Informe os dois planos existentes' using errcode='22023';end if;
 for plan in select value from jsonb_array_elements(p_plans) loop
  code:=plan->>'code'; title:=btrim(plan->>'name');
  if code is null or code not in ('free','complete') or title is null or char_length(title) not between 1 and 100
   or coalesce(plan->>'monthly_cents','') !~ '^[0-9]{1,8}$'
   or coalesce(plan->>'commission_basis_points','') !~ '^[0-9]{1,5}$'
   or coalesce(plan->>'trial_days','') !~ '^[0-9]{1,3}$' then raise exception 'Condições inválidas' using errcode='22023';end if;
  amount:=(plan->>'monthly_cents')::integer; commission:=(plan->>'commission_basis_points')::integer; trial:=(plan->>'trial_days')::integer;
  if commission>10000 or trial>365 then raise exception 'Limites inválidos' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(checked) p where p->>'code'=code) then raise exception 'Plano duplicado' using errcode='22023';end if;
  checked:=checked||jsonb_build_array(jsonb_build_object('code',code,'name',title,'monthly_cents',amount,'commission_basis_points',commission,'trial_days',trial,'billing_cycle',case when code='free' then 'weekly' else 'monthly' end));
 end loop;
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
 (select id,requested_plan,status,created_at,updated_at,decision_note from pitacco_private.plan_change_requests where store_id=p_store order by created_at desc limit 20) r),'[]'::jsonb)) into result
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
 if not exists(select 1 from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) p where v.revision=p_terms and p->>'code'=p_plan) then raise exception 'Plano indisponível' using errcode='22023';end if;
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja não encontrada';end if;
 select * into existing from pitacco_private.plan_change_requests where store_id=p_store and status in ('pending','in_review');
 if found then
  if existing.requested_plan=p_plan then return existing.id;end if;
  raise exception 'Cancele a solicitação anterior antes de escolher outro plano';
 end if;
 insert into pitacco_private.plan_change_requests(store_id,requested_by,requested_plan,terms_version) values(p_store,auth.uid(),p_plan,p_terms) returning id into new_id;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'plan_change_requested',jsonb_build_object('request_id',new_id,'plan',p_plan,'terms',p_terms));
 return new_id;
end $$;

revoke all on function public.pitacco_owner_plan_catalog(),public.pitacco_owner_publish_plan_catalog(text,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_owner_plan_catalog(),public.pitacco_owner_publish_plan_catalog(text,jsonb) to authenticated;
notify pgrst,'reload schema';
