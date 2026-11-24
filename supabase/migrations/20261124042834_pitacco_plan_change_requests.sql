create table if not exists pitacco_private.plan_change_requests(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 requested_by uuid not null,
 requested_plan text not null check(requested_plan in ('free','complete')),
 terms_version text not null check(terms_version='2026-11-24-v1'),
 status text not null default 'pending' check(status in ('pending','in_review','cancelled','declined')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 decided_by uuid,
 decision_note text
);
alter table pitacco_private.plan_change_requests enable row level security;
revoke all on pitacco_private.plan_change_requests from public,anon,authenticated;
create unique index if not exists pitacco_plan_change_pending on pitacco_private.plan_change_requests(store_id) where status in ('pending','in_review');
create or replace function public.pitacco_merchant_plan_options(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 return jsonb_build_object('terms_version','2026-11-24-v1','activation_mode','review',
 'plans',jsonb_build_array(
 jsonb_build_object('code','free','name','Grátis para sempre','monthly_cents',0,'commission_basis_points',500,'billing_cycle','weekly','trial_days',0),
 jsonb_build_object('code','complete','name','Completo','monthly_cents',5990,'commission_basis_points',0,'billing_cycle','monthly','trial_days',30)),
 'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from
 (select id,requested_plan,status,created_at,updated_at,decision_note from pitacco_private.plan_change_requests where store_id=p_store order by created_at desc limit 20) r),'[]'::jsonb));
end $$;
create or replace function public.pitacco_request_plan_change(p_store uuid,p_plan text,p_terms text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing pitacco_private.plan_change_requests%rowtype; new_id uuid;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_plan is null or p_plan not in ('free','complete') or p_terms is distinct from '2026-11-24-v1' then raise exception 'Plano ou termos inválidos';end if;
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
create or replace function public.pitacco_cancel_plan_change(p_store uuid,p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 update pitacco_private.plan_change_requests set status='cancelled',updated_at=now(),decided_by=auth.uid() where id=p_request and store_id=p_store and status in ('pending','in_review');
 if not found then raise exception 'Solicitação não está pendente';end if;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'plan_change_cancelled',jsonb_build_object('request_id',p_request));
end $$;
create or replace function public.pitacco_owner_plan_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Sem permissão' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from
 (select c.id,c.store_id,s.name as store_name,c.requested_plan,c.status,c.created_at,c.updated_at,c.decision_note from pitacco_private.plan_change_requests c join public.stores s on s.id=c.store_id order by c.created_at desc limit 200) r),'[]'::jsonb);
end $$;
create or replace function public.pitacco_owner_review_plan_request(p_request uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_status is null or p_status not in ('in_review','declined') or length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'Informe uma situação e justificativa válidas';end if;
 update pitacco_private.plan_change_requests set status=p_status,decision_note=btrim(p_note),updated_at=now(),decided_by=auth.uid() where id=p_request and status in ('pending','in_review') returning store_id into s;
 if not found then raise exception 'Solicitação não está pendente';end if;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(s,auth.uid(),'plan_change_reviewed',jsonb_build_object('request_id',p_request,'status',p_status,'reason',p_note));
end $$;
revoke all on function public.pitacco_merchant_plan_options(uuid),public.pitacco_request_plan_change(uuid,text,text),public.pitacco_cancel_plan_change(uuid,uuid),public.pitacco_owner_plan_requests(),public.pitacco_owner_review_plan_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_plan_options(uuid),public.pitacco_request_plan_change(uuid,text,text),public.pitacco_cancel_plan_change(uuid,uuid),public.pitacco_owner_plan_requests(),public.pitacco_owner_review_plan_request(uuid,text,text) to authenticated;
notify pgrst,'reload schema';