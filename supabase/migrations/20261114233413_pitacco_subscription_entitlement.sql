create table pitacco_private.subscription_control (
  singleton boolean primary key default true check (singleton),
  enforce_new_orders boolean not null default false,
  regularization_url text,
  check (regularization_url is null or (length(regularization_url) <= 1000 and regularization_url ~ '^https://[^[:space:]]+$')),
  check (not enforce_new_orders or regularization_url is not null)
);
insert into pitacco_private.subscription_control(singleton) values (true);

create table pitacco_private.subscription_payments (
  provider text not null check (provider in ('pagbank','mercado_pago','stone','asaas','efi')),
  provider_payment_id text not null check (char_length(btrim(provider_payment_id)) between 1 and 200),
  store_id uuid not null references public.stores(id),
  amount numeric(12,2) not null check (amount=59.90),
  confirmed_at timestamptz not null default now(),
  paid_until timestamptz not null,
  primary key (provider,provider_payment_id)
);
create index pitacco_subscription_payments_store on pitacco_private.subscription_payments (store_id,paid_until desc);
revoke all on pitacco_private.subscription_control, pitacco_private.subscription_payments from public, anon, authenticated;

create function pitacco_private.subscription_state(p_store uuid)
returns table(status text, trial_ends_at timestamptz, paid_until timestamptz)
language sql stable set search_path = '' as $function$
  select case
    when payment.paid_until>now() then 'active'
    when trial.ends_at>now() then 'trial'
    when trial.ends_at is not null or payment.paid_until is not null then 'overdue'
    else 'legacy'
  end, trial.ends_at,payment.paid_until
  from public.stores store
  left join public.pitacco_signup_trials trial on trial.first_store_id=store.id
  left join lateral (
    select p.paid_until from pitacco_private.subscription_payments p
    where p.store_id=store.id order by p.paid_until desc limit 1
  ) payment on true
  where store.id=p_store
$function$;
revoke all on function pitacco_private.subscription_state(uuid) from public, anon, authenticated;

create function public.pitacco_store_subscription_status(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.can_access_store(p_store) then
    raise exception 'Sem permissão para consultar a assinatura desta loja';
  end if;
  select jsonb_build_object(
    'status',state.status,'trial_ends_at',state.trial_ends_at,'paid_until',state.paid_until,
    'amount',59.90,'orders_blocked',control.enforce_new_orders and state.status='overdue',
    'regularization_url',control.regularization_url
  ) into result
  from pitacco_private.subscription_state(p_store) state
  cross join pitacco_private.subscription_control control;
  return result;
end;
$function$;
revoke all on function public.pitacco_store_subscription_status(uuid) from public, anon;
grant execute on function public.pitacco_store_subscription_status(uuid) to authenticated;

-- Only a trusted, provider-verifying backend may call this endpoint after
-- reconciling a settled payment and the store attached to its invoice.
create function public.pitacco_record_confirmed_subscription_payment(
  p_store uuid, p_provider text, p_payment_id text, p_amount numeric
) returns timestamptz language plpgsql security definer set search_path = '' as $function$
declare
  payment pitacco_private.subscription_payments%rowtype;
  key text := btrim(p_payment_id);
  coverage_start timestamptz;
  coverage_end timestamptz;
begin
  if p_store is null or p_provider is null or p_provider not in ('pagbank','mercado_pago','stone','asaas','efi')
     or key is null or char_length(key) not between 1 and 200 or p_amount is distinct from 59.90::numeric then
    raise exception 'Pagamento da assinatura inválido';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||key,0));
  select * into payment from pitacco_private.subscription_payments
    where provider=p_provider and provider_payment_id=key;
  if found then
    if payment.store_id<>p_store then raise exception 'Pagamento vinculado a outro estabelecimento'; end if;
    return payment.paid_until;
  end if;

  perform 1 from public.stores where id=p_store for update;
  if not found then raise exception 'Estabelecimento indisponível'; end if;
  select greatest(now(),state.trial_ends_at,state.paid_until) into coverage_start
    from pitacco_private.subscription_state(p_store) state;
  coverage_end := ((coverage_start at time zone 'America/Sao_Paulo')+interval '1 month') at time zone 'America/Sao_Paulo';

  insert into pitacco_private.subscription_payments(provider,provider_payment_id,store_id,amount,paid_until)
    values (p_provider,key,p_store,p_amount,coverage_end);
  insert into public.subscriptions(store_id,status,monthly_amount,due_date,updated_at)
    values (p_store,'ativa',59.90,(coverage_end at time zone 'America/Sao_Paulo')::date,now())
    on conflict (store_id) do update set
      status=excluded.status,monthly_amount=excluded.monthly_amount,due_date=excluded.due_date,updated_at=excluded.updated_at;
  return coverage_end;
end;
$function$;
revoke all on function public.pitacco_record_confirmed_subscription_payment(uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function public.pitacco_record_confirmed_subscription_payment(uuid,text,text,numeric) to service_role;

create function public.pitacco_subscription_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Acesso reservado à administração do Pitacco';
  end if;

  select jsonb_build_object(
    'registered',count(*),'trial',count(*) filter(where state.status='trial'),
    'active',count(*) filter(where state.status='active'),'overdue',count(*) filter(where state.status='overdue'),
    'legacy',count(*) filter(where state.status='legacy'),
    'monthly_recurring_revenue',59.90*(count(*) filter(where state.status='active'))
  ) into result
  from public.stores store cross join lateral pitacco_private.subscription_state(store.id) state;
  return result;
end;
$function$;
revoke all on function public.pitacco_subscription_overview() from public, anon;
grant execute on function public.pitacco_subscription_overview() to authenticated;

-- Enabling enforcement requires an available regularization portal. Existing
-- orders, idempotent checkout retries and historical accounting remain usable.
create function pitacco_private.enforce_subscription_for_order()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status<>'historical'
    and exists(select 1 from pitacco_private.subscription_control where enforce_new_orders)
    and exists(select 1 from pitacco_private.subscription_state(new.store_id) where status='overdue') then
    raise exception 'Loja temporariamente indisponível para novos pedidos';
  end if;
  return new;
end;
$function$;
revoke all on function pitacco_private.enforce_subscription_for_order() from public, anon, authenticated;
create trigger pitacco_enforce_subscription_before_new_order before insert on public.orders
  for each row execute function pitacco_private.enforce_subscription_for_order();
