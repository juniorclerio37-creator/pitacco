
create table pitacco_private.asaas_customer_provision_attempts(
 store_id uuid primary key references public.stores(id),
 created_at timestamptz not null default now()
);
alter table pitacco_private.asaas_customer_provision_attempts enable row level security;
revoke all on pitacco_private.asaas_customer_provision_attempts from public,anon,authenticated;
-- Called by the Edge Function after resolving the caller with Supabase Auth.
-- An existing identity hash must match; a legacy store requires verified enrollment.
create function public.pitacco_asaas_prepare_customer(p_actor uuid,p_invoice uuid,p_document text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s uuid; n text; doc text; customer text; pepper_value text; fresh boolean;
begin
 if not exists(select 1 from pitacco_private.subscription_control where asaas_environment='production') then raise exception 'Asaas indisponível';end if;
 select b.store_id into s from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end)
 where i.id=p_invoice and b.state='calculated' and b.amount_cents=i.amount_cents and not exists(select 1 from pitacco_private.commercial_manual_payments m where m.invoice_id=i.id);
 if s is null or not exists(select 1 from public.store_members where store_id=s and user_id=p_actor and role='gestor') then raise exception 'Cobrança indisponível' using errcode='42501';end if;
 perform 1 from public.stores where id=s for update;
 if exists(select 1 from pitacco_private.commercial_payment_claims where invoice_id=p_invoice and status='pending') then raise exception 'Comprovante em análise';end if;
 select customer_id into customer from pitacco_private.asaas_commercial_customers where store_id=s;
 if customer is not null then return jsonb_build_object('store_id',s,'customer_id',customer,'allow_create',false);end if;
 doc:=regexp_replace(coalesce(p_document,''),'[^0-9]','','g');
 if not pitacco_private.valid_document(doc) then raise exception 'Documento inválido';end if;
 select pepper into pepper_value from pitacco_private.identity_secret where id=true;
 if not exists(select 1 from pitacco_private.trial_identity_registry t where t.first_store_id=s and t.identity_hash=encode(extensions.hmac(doc,pepper_value,'sha256'),'hex')) then raise exception 'Identidade fiscal requer validação pelo suporte';end if;
 select name into n from public.stores where id=s;
 insert into pitacco_private.asaas_customer_provision_attempts(store_id) values(s) on conflict do nothing;
 fresh:=found;
 return jsonb_build_object('store_id',s,'name',n,'allow_create',fresh);
end $$;
create function public.pitacco_asaas_bind_customer(p_store uuid,p_customer text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from pitacco_private.asaas_customer_provision_attempts where store_id=p_store) then raise exception 'Cadastro não reservado';end if;
 insert into pitacco_private.asaas_commercial_customers(store_id,customer_id) values(p_store,p_customer) on conflict(store_id) do nothing;
 if not exists(select 1 from pitacco_private.asaas_commercial_customers where store_id=p_store and customer_id=p_customer) then raise exception 'Cliente divergente';end if;
end $$;
create function public.pitacco_asaas_reserve_charge(p_actor uuid,p_invoice uuid,p_customer text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i pitacco_private.commercial_invoices%rowtype; b pitacco_private.commercial_closings%rowtype; c pitacco_private.asaas_commercial_charges%rowtype; fresh boolean;
begin
 select * into i from pitacco_private.commercial_invoices where id=p_invoice for update;
 if not found then raise exception 'Cobrança indisponível';end if;
 select * into b from pitacco_private.commercial_closings where contract_id=i.contract_id and kind=i.kind and period_end=i.period_end;
 if not exists(select 1 from public.store_members where store_id=b.store_id and user_id=p_actor and role='gestor') or not exists(select 1 from pitacco_private.asaas_commercial_customers where store_id=b.store_id and customer_id=p_customer) then raise exception 'Sem permissão' using errcode='42501';end if;
 if b.state is distinct from 'calculated' or b.amount_cents is distinct from i.amount_cents or exists(select 1 from pitacco_private.commercial_manual_payments where invoice_id=i.id) or exists(select 1 from pitacco_private.commercial_payment_claims where invoice_id=i.id and status='pending') then raise exception 'Cobrança indisponível';end if;
 insert into pitacco_private.asaas_commercial_charges(invoice_id,customer_id) values(i.id,p_customer) on conflict do nothing;
 fresh:=found;
 select * into c from pitacco_private.asaas_commercial_charges where invoice_id=i.id;
 if c.customer_id is distinct from p_customer then raise exception 'Cliente divergente';end if;
 return jsonb_build_object('allow_create',fresh,'payment_id',c.payment_id,'amount_cents',i.amount_cents,'due_date',greatest((i.due_at at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date),'kind',i.kind);
end $$;
create function public.pitacco_asaas_bind_charge(p_invoice uuid,p_customer text,p_payment text)
returns void language plpgsql security definer set search_path='' as $$
begin
 update pitacco_private.asaas_commercial_charges set payment_id=p_payment where invoice_id=p_invoice and customer_id=p_customer and (payment_id is null or payment_id=p_payment);
 if not found then raise exception 'Cobrança divergente';end if;
end $$;
revoke all on function public.pitacco_asaas_prepare_customer(uuid,uuid,text),public.pitacco_asaas_bind_customer(uuid,text),public.pitacco_asaas_reserve_charge(uuid,uuid,text),public.pitacco_asaas_bind_charge(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_asaas_prepare_customer(uuid,uuid,text),public.pitacco_asaas_bind_customer(uuid,text),public.pitacco_asaas_reserve_charge(uuid,uuid,text),public.pitacco_asaas_bind_charge(uuid,text,text) to service_role;

