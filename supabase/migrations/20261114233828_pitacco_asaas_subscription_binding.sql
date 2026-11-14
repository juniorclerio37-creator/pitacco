alter table pitacco_private.subscription_control
  add column asaas_environment text check (asaas_environment in ('sandbox','production'));

create table pitacco_private.asaas_subscription_bindings (
  environment text not null check (environment in ('sandbox','production')),
  subscription_id text not null check (subscription_id ~ '^sub_[A-Za-z0-9_-]{1,100}$'),
  store_id uuid not null references public.stores(id),
  primary key (environment,subscription_id),
  unique (environment,store_id)
);
revoke all on pitacco_private.asaas_subscription_bindings from public, anon, authenticated;

create function public.pitacco_record_asaas_subscription_payment(
  p_environment text, p_subscription_id text, p_payment_id text, p_amount numeric
) returns timestamptz language plpgsql security definer set search_path = '' as $function$
declare target_store uuid;
begin
  if p_environment is null or not exists (
    select 1 from pitacco_private.subscription_control where asaas_environment=p_environment
  ) then
    raise exception 'Ambiente do Asaas ainda não habilitado';
  end if;
  if p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9_-]{1,100}$' then
    raise exception 'Identificador de cobrança inválido';
  end if;
  select binding.store_id into target_store from pitacco_private.asaas_subscription_bindings binding
    where binding.environment=p_environment and binding.subscription_id=p_subscription_id;
  if not found then return null; end if;

  return public.pitacco_record_confirmed_subscription_payment(
    target_store,'asaas',p_environment||':'||p_payment_id,p_amount
  );
end;
$function$;
revoke all on function public.pitacco_record_asaas_subscription_payment(text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.pitacco_record_asaas_subscription_payment(text,text,text,numeric) to service_role;
