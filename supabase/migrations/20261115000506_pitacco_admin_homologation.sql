create table pitacco_private.homologation_results (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete set null,
  scope text not null check (scope in ('asaas','marketplaces','repasse','pedidos','entregas','whatsapp','windows','publicacao')),
  outcome text not null check (outcome in ('approved','failed','pending')),
  notes text not null check (char_length(btrim(notes)) between 3 and 1200),
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null,
  request_id uuid not null,
  unique(recorded_by,request_id)
);
revoke all on pitacco_private.homologation_results from public,anon,authenticated;

create function public.pitacco_admin_homologation_results()
returns table(id bigint,store_id uuid,store_name text,scope text,outcome text,notes text,recorded_at timestamptz)
language plpgsql stable security definer set search_path='' as $function$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo da administração do Pitacco'; end if;
  return query
    select result.id,result.store_id,store.name,result.scope,result.outcome,result.notes,result.recorded_at
    from pitacco_private.homologation_results result
    left join public.stores store on store.id=result.store_id
    order by result.id desc limit 50;
end;
$function$;

create function public.pitacco_admin_record_homologation(p_store uuid,p_scope text,p_outcome text,p_notes text,p_request uuid)
returns bigint language plpgsql security definer set search_path='' as $function$
declare recorded bigint; existing pitacco_private.homologation_results%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo da administração do Pitacco'; end if;
  if p_request is null or p_scope is null or p_scope not in ('asaas','marketplaces','repasse','pedidos','entregas','whatsapp','windows','publicacao')
    or p_outcome is null or p_outcome not in ('approved','failed','pending')
    or p_notes is null or char_length(btrim(p_notes)) not between 3 and 1200 then
    raise exception 'Informe o teste, o resultado e uma observação de 3 a 1200 caracteres';
  end if;
  insert into pitacco_private.homologation_results(store_id,scope,outcome,notes,recorded_by,request_id)
  values(p_store,p_scope,p_outcome,btrim(p_notes),auth.uid(),p_request)
  on conflict(recorded_by,request_id) do nothing returning id into recorded;
  if recorded is not null then return recorded; end if;
  select * into existing from pitacco_private.homologation_results where recorded_by=auth.uid() and request_id=p_request;
  if existing.store_id is distinct from p_store or existing.scope<>p_scope or existing.outcome<>p_outcome or existing.notes<>btrim(p_notes) then
    raise exception 'Esta tentativa de registro já foi usada com dados diferentes';
  end if;
  return existing.id;
end;
$function$;

create function public.pitacco_admin_homologation_probe(
  p_store uuid,p_subscription text default null,p_payment text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare menu public.public_menu_settings%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo da administração do Pitacco'; end if;
  if p_store is null or not exists(select 1 from public.stores where id=p_store) then raise exception 'Selecione um estabelecimento válido'; end if;
  select * into menu from public.public_menu_settings where store_id=p_store limit 1;
  return jsonb_build_object(
    'menu_slug',case when menu.enabled then menu.slug end,
    'menu_has_checkout',coalesce(menu.enabled and (menu.delivery_enabled or menu.pickup_enabled) and cardinality(menu.payment_methods)>0,false),
    'has_active_products',exists(select 1 from public.products where store_id=p_store and menu_active),
    'asaas_environment',(select asaas_environment from pitacco_private.subscription_control),
    'sandbox_store_linked',exists(select 1 from pitacco_private.asaas_subscription_bindings where environment='sandbox' and store_id=p_store),
    'sandbox_payment_linked',exists(
      select 1 from pitacco_private.asaas_subscription_bindings
      where environment='sandbox' and store_id=p_store and subscription_id=p_subscription
    ),
    'sandbox_payment_recorded',exists(
      select 1 from pitacco_private.subscription_payments
      where provider='asaas' and store_id=p_store and provider_payment_id='sandbox:'||p_payment
    )
  );
end;
$function$;

revoke all on function public.pitacco_admin_homologation_results(),
  public.pitacco_admin_record_homologation(uuid,text,text,text,uuid),
  public.pitacco_admin_homologation_probe(uuid,text,text) from public,anon;
grant execute on function public.pitacco_admin_homologation_results(),
  public.pitacco_admin_record_homologation(uuid,text,text,text,uuid),
  public.pitacco_admin_homologation_probe(uuid,text,text) to authenticated;
