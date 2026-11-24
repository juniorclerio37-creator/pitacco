
create function public.pitacco_asaas_prepare_store_customer(p_actor uuid,p_store uuid,p_document text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc text; pepper_value text; customer text; n text; fresh boolean;
begin
 if not exists(select 1 from pitacco_private.subscription_control where asaas_environment='production') then raise exception 'Asaas indisponível';end if;
 if not exists(select 1 from public.store_members where store_id=p_store and user_id=p_actor and role='gestor') then raise exception 'Sem permissão' using errcode='42501';end if;
 select name into n from public.stores where id=p_store for update;
 if not found then raise exception 'Loja indisponível';end if;
 select customer_id into customer from pitacco_private.asaas_commercial_customers where store_id=p_store;
 if customer is not null then return jsonb_build_object('store_id',p_store,'customer_id',customer,'allow_create',false);end if;
 doc:=regexp_replace(coalesce(p_document,''),'[^0-9]','','g');
 if not pitacco_private.valid_document(doc) then raise exception 'Documento inválido';end if;
 select pepper into pepper_value from pitacco_private.identity_secret where id=true;
 if not exists(select 1 from pitacco_private.trial_identity_registry t where t.first_store_id=p_store and t.identity_hash=encode(extensions.hmac(doc,pepper_value,'sha256'),'hex')) then raise exception 'Identidade fiscal requer validação pelo suporte';end if;
 insert into pitacco_private.asaas_customer_provision_attempts(store_id) values(p_store) on conflict do nothing;
 fresh:=found;
 return jsonb_build_object('store_id',p_store,'name',n,'allow_create',fresh);
end $$;
revoke all on function public.pitacco_asaas_prepare_store_customer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_asaas_prepare_store_customer(uuid,uuid,text) to service_role;
-- Once a provider payment is reserved, don't approve a second manual payment
-- until the provider charge is explicitly reconciled/cancelled.
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_submit_commercial_payment(uuid,text,text,text)'::regprocedure) into d;
 a:='if not exists(select 1 from pitacco_private.commercial_billing_control';
 if position(a in d)=0 then raise exception 'Manual claim function changed';end if;
 execute replace(d,a,'if exists(select 1 from pitacco_private.asaas_commercial_charges where invoice_id=i.id) then raise exception ''Já existe cobrança Asaas para esta fatura. Utilize a mesma cobrança ou solicite conciliação.'';end if; '||a);
 select pg_get_functiondef('public.pitacco_owner_confirm_commercial_payment(uuid,bigint,text,text)'::regprocedure) into d;
 a:='select * into existing from pitacco_private.commercial_manual_payments';
 if position(a in d)=0 then raise exception 'Manual confirmation function changed';end if;
 execute replace(d,a,'if exists(select 1 from pitacco_private.asaas_commercial_charges where invoice_id=i.id) then raise exception ''Cobrança Asaas existente; concilie antes de confirmar manualmente.'';end if; '||a);
 select pg_get_functiondef('public.pitacco_commercial_invoices(uuid,integer)'::regprocedure) into d;
 a:='p.verified_at as paid_at,';
 if position(a in d)=0 then raise exception 'Invoice list changed';end if;
 execute replace(d,a,'p.verified_at as paid_at,p.payment_source,exists(select 1 from pitacco_private.asaas_commercial_charges ac where ac.invoice_id=i.id) as asaas_reserved,exists(select 1 from pitacco_private.asaas_commercial_customers ac where ac.store_id=b.store_id) as asaas_customer_linked,');
end $patch$;

