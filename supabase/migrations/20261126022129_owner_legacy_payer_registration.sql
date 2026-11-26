
create table pitacco_private.commercial_fiscal_identity (
 store_id uuid primary key references public.stores(id),
 identity_kind text not null check(identity_kind in ('cpf','cnpj')),
 identity_hash text not null,
 document_last4 text not null check(document_last4 ~ '^[0-9]{4}$'),
 verified_by uuid not null,
 created_at timestamptz not null default now()
);
alter table pitacco_private.commercial_fiscal_identity enable row level security;
revoke all on pitacco_private.commercial_fiscal_identity from public,anon,authenticated;
create function public.pitacco_asaas_prepare_owner_customer(p_actor uuid,p_store uuid,p_document text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc text; h text; pepper_value text; customer text; n text; fresh boolean; kind text;
begin
 if not exists(select 1 from pitacco_private.platform_owner where user_id=p_actor) then raise exception 'Sem permissão' using errcode='42501';end if;
 if not exists(select 1 from pitacco_private.subscription_control where asaas_environment='production') then raise exception 'Pagamento automático indisponível';end if;
 select name into n from public.stores where id=p_store for update;
 if not found then raise exception 'Loja indisponível';end if;
 doc:=regexp_replace(coalesce(p_document,''),'[^0-9]','','g');
 if not pitacco_private.valid_document(doc) then raise exception 'CPF ou CNPJ inválido';end if;
 select pepper into pepper_value from pitacco_private.identity_secret where id=true;
 h:=encode(extensions.hmac(doc,pepper_value,'sha256'),'hex');
 kind:=case when length(doc)=14 then 'cnpj' else 'cpf' end;
 if exists(select 1 from pitacco_private.trial_identity_registry t where t.first_store_id=p_store and t.identity_hash is distinct from h) or exists(select 1 from pitacco_private.commercial_fiscal_identity t where t.store_id=p_store and t.identity_hash is distinct from h) then raise exception 'Documento diverge do cadastro anterior; concilie antes de alterar';end if;
 select customer_id into customer from pitacco_private.asaas_commercial_customers where store_id=p_store;
 if customer is not null then return jsonb_build_object('store_id',p_store,'customer_id',customer,'allow_create',false);end if;
 insert into pitacco_private.commercial_fiscal_identity(store_id,identity_kind,identity_hash,document_last4,verified_by) values(p_store,kind,h,right(doc,4),p_actor) on conflict(store_id) do nothing;
 insert into pitacco_private.asaas_customer_provision_attempts(store_id) values(p_store) on conflict do nothing;
 fresh:=found;
 return jsonb_build_object('store_id',p_store,'name',n,'allow_create',fresh);
end $$;
revoke all on function public.pitacco_asaas_prepare_owner_customer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_asaas_prepare_owner_customer(uuid,uuid,text) to service_role;
create function public.pitacco_owner_payer_status(p_store uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return jsonb_build_object('registered',exists(select 1 from pitacco_private.asaas_commercial_customers where store_id=p_store),'attempted',exists(select 1 from pitacco_private.asaas_customer_provision_attempts where store_id=p_store));
end $$;
revoke all on function public.pitacco_owner_payer_status(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_payer_status(uuid) to authenticated;
do $patch$ declare f text; sig regprocedure; a text; begin
 a:='(select case when t.document_last4 is not null then upper(t.identity_kind)||'' final ''||t.document_last4 else upper(t.identity_kind)||'' cadastrado (número indisponível)'' end from pitacco_private.trial_identity_registry t where t.first_store_id=b.store_id limit 1) as fiscal_identity';
 foreach sig in array array['public.pitacco_commercial_invoices(uuid,integer)'::regprocedure,'public.pitacco_owner_commercial_payment_claims(uuid,text,integer)'::regprocedure] loop
 select pg_get_functiondef(sig) into f;
 if strpos(f,a)=0 then raise exception 'Fiscal listing anchor missing';end if;
 execute replace(f,a,'coalesce((select upper(t.identity_kind)||'' final ''||t.document_last4 from pitacco_private.commercial_fiscal_identity t where t.store_id=b.store_id),'||replace(a,' as fiscal_identity','')||') as fiscal_identity');
 end loop;
end $patch$;
notify pgrst,'reload schema';
