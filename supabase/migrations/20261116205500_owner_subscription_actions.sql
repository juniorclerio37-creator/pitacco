
create table if not exists pitacco_private.subscription_admin_controls (
 store_id uuid primary key references public.stores(id) on delete cascade,
 trial_extension_until timestamptz,
 courtesy_until timestamptz,
 suspended boolean not null default false,
 billing_due_date date,
 notes text not null default '',
 updated_at timestamptz not null default now(),
 updated_by uuid
);
create table if not exists pitacco_private.subscription_admin_audit (
 id bigint generated always as identity primary key,
 store_id uuid not null references public.stores(id) on delete cascade,
 actor_id uuid not null,
 action text not null,
 details jsonb not null,
 created_at timestamptz not null default now()
);
revoke all on pitacco_private.subscription_admin_controls,pitacco_private.subscription_admin_audit from public,anon,authenticated;
create or replace function pitacco_private.subscription_state(p_store uuid)
returns table(status text,trial_ends_at timestamptz,paid_until timestamptz)
language sql stable set search_path = '' as $$
 select case
   when coalesce(admin.suspended,false) then 'suspended'
   when payment.paid_until>now() then 'active'
   when admin.courtesy_until>now() then 'courtesy'
   when greatest(trial.ends_at,admin.trial_extension_until)>now() then 'trial'
   when trial.ends_at is not null or admin.trial_extension_until is not null or admin.courtesy_until is not null or payment.paid_until is not null then 'overdue'
   else 'legacy'
 end,
 greatest(trial.ends_at,admin.trial_extension_until),payment.paid_until
 from public.stores store
 left join public.pitacco_signup_trials trial on trial.first_store_id=store.id
 left join pitacco_private.subscription_admin_controls admin on admin.store_id=store.id
 left join lateral (select p.paid_until from pitacco_private.subscription_payments p where p.store_id=store.id order by p.paid_until desc limit 1) payment on true
 where store.id=p_store
$$;
create or replace function pitacco_private.enforce_subscription_for_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status<>'historical'
 and exists(select 1 from pitacco_private.subscription_state(new.store_id) state where state.status='suspended' or (state.status='overdue' and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders))) then
  raise exception 'Loja temporariamente indisponível para novos pedidos';
 end if;
 return new;
end;
$$;
create or replace function public.pitacco_store_subscription_status(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.can_access_store(p_store) then
  raise exception 'Sem permissão para consultar a assinatura desta loja';
 end if;
 select jsonb_build_object('status',state.status,'trial_ends_at',state.trial_ends_at,
  'paid_until',state.paid_until,'amount',59.90,
  'orders_blocked',(state.status='suspended' or (control.enforce_new_orders and state.status='overdue')),
  'regularization_url',control.regularization_url)
 into result from pitacco_private.subscription_state(p_store) state
 cross join pitacco_private.subscription_control control;
 return result;
end;
$$;
create or replace function public.pitacco_owner_subscription_action(p_store uuid,p_action text,p_days integer default null,p_value text default null,p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare old_row pitacco_private.subscription_admin_controls%rowtype;
declare new_row pitacco_private.subscription_admin_controls%rowtype;
declare base_time timestamptz;
declare trial_end timestamptz;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo do proprietário'; end if;
 if p_reason is null or length(btrim(p_reason))<5 or length(p_reason)>500 then raise exception 'Informe uma justificativa de 5 a 500 caracteres'; end if;
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja não encontrada'; end if;
 insert into pitacco_private.subscription_admin_controls(store_id) values(p_store) on conflict do nothing;
 select * into old_row from pitacco_private.subscription_admin_controls where store_id=p_store for update;
 if p_action in ('extend_trial','courtesy') then
  if p_days is null or p_days<1 or p_days>365 then raise exception 'Informe de 1 a 365 dias'; end if;
  if p_action='extend_trial' then
   select greatest(now(),trial.ends_at,old_row.trial_extension_until) into base_time
    from public.pitacco_signup_trials trial where trial.first_store_id=p_store;
   if base_time is null then raise exception 'Esta loja não possui teste gratuito'; end if;
   update pitacco_private.subscription_admin_controls set trial_extension_until=base_time+make_interval(days=>p_days) where store_id=p_store;
  else
   update pitacco_private.subscription_admin_controls set courtesy_until=greatest(now(),old_row.courtesy_until)+make_interval(days=>p_days) where store_id=p_store;
  end if;
 elsif p_action='suspend' then
  update pitacco_private.subscription_admin_controls set suspended=true where store_id=p_store;
 elsif p_action='reactivate' then
  update pitacco_private.subscription_admin_controls set suspended=false where store_id=p_store;
 elsif p_action='due_date' then
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida'; end if;
  update pitacco_private.subscription_admin_controls set billing_due_date=p_value::date where store_id=p_store;
 elsif p_action='notes' then
  if p_value is null or length(p_value)>3000 then raise exception 'Observação inválida'; end if;
  update pitacco_private.subscription_admin_controls set notes=p_value where store_id=p_store;
 else raise exception 'Ação inválida';
 end if;
 update pitacco_private.subscription_admin_controls set updated_at=now(),updated_by=auth.uid() where store_id=p_store returning * into new_row;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details)
 values(p_store,auth.uid(),p_action,jsonb_build_object('before',to_jsonb(old_row),'after',to_jsonb(new_row),'reason',p_reason,'days',p_days));
 return jsonb_build_object('ok',true,'action',p_action,'store_id',p_store);
end;
$$;
revoke all on function public.pitacco_owner_subscription_action(uuid,text,integer,text,text) from public,anon;
grant execute on function public.pitacco_owner_subscription_action(uuid,text,integer,text,text) to authenticated;
create or replace function public.pitacco_owner_subscription_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo do proprietário'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',s.id,'name',s.name,'phone',s.phone,'created_at',s.created_at,
 'status',state.status,'trial_ends_at',state.trial_ends_at,'paid_until',state.paid_until,
 'plan','Pitacco Padrão','monthly_amount',coalesce(sub.monthly_amount,59.90),
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
 'monthly_recurring_revenue',59.90*(count(*) filter(where state.status='active')))
 into result from public.stores store cross join lateral pitacco_private.subscription_state(store.id) state;
 return result;
end;
$$;
