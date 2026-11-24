-- Candidate. No customer is created automatically from missing or inferred tax data.
create table pitacco_private.commercial_asaas_customer_intents(
 store_id uuid primary key references public.stores(id),
 environment text not null check(environment='production'),
 created_at timestamptz not null default now(),
 state text not null default 'reserved' check(state in ('reserved','linked','review_required'))
);
alter table pitacco_private.commercial_asaas_customer_intents enable row level security;
revoke all on pitacco_private.commercial_asaas_customer_intents from public,anon,authenticated,service_role;
-- User-facing authorization probe; no financial identity is returned.
create function public.pitacco_owner_asaas_enrollment_access(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 if not exists(select 1 from public.stores where id=p_store) then raise exception 'Loja indisponível';end if;
 return jsonb_build_object('allowed',true,'linked',exists(select 1 from pitacco_private.commercial_asaas_customers where store_id=p_store and environment='production'));
end $$;
revoke all on function public.pitacco_owner_asaas_enrollment_access(uuid) from public,anon;
grant execute on function public.pitacco_owner_asaas_enrollment_access(uuid) to authenticated;
create function pitacco_private.reserve_asaas_customer(p_store uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.stores where id=p_store for update;
 if not found then return 'unavailable';end if;
 if exists(select 1 from pitacco_private.commercial_asaas_customers where store_id=p_store and environment='production') then return 'already_linked';end if;
 if exists(select 1 from pitacco_private.commercial_asaas_customer_intents where store_id=p_store) then return 'recover_only';end if;
 insert into pitacco_private.commercial_asaas_customer_intents(store_id,environment) values(p_store,'production');
 return 'reserved';
end $$;
revoke all on function pitacco_private.reserve_asaas_customer(uuid) from public,anon,authenticated;
grant execute on function pitacco_private.reserve_asaas_customer(uuid) to service_role;
create function public.pitacco_reserve_asaas_customer(p_store uuid) returns text language sql security invoker set search_path='' as $$
 select pitacco_private.reserve_asaas_customer(p_store)
$$;
revoke all on function public.pitacco_reserve_asaas_customer(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_reserve_asaas_customer(uuid) to service_role;
create function pitacco_private.finalize_asaas_customer(p_store uuid,p_customer_id text)
returns text language plpgsql security definer set search_path='' as $$
declare existing text;
begin
 perform 1 from public.stores where id=p_store for update;
 if not found then return 'unavailable';end if;
 select customer_id into existing from pitacco_private.commercial_asaas_customers where store_id=p_store and environment='production';
 if found then return case when existing=p_customer_id then 'already_linked' else 'review_required' end;end if;
 if not exists(select 1 from pitacco_private.commercial_asaas_customer_intents where store_id=p_store) then return 'unavailable';end if;
 insert into pitacco_private.commercial_asaas_customers(store_id,environment,customer_id) values(p_store,'production',p_customer_id);
 update pitacco_private.commercial_asaas_customer_intents set state='linked' where store_id=p_store;
 return 'linked';
end $$;
revoke all on function pitacco_private.finalize_asaas_customer(uuid,text) from public,anon,authenticated;
grant execute on function pitacco_private.finalize_asaas_customer(uuid,text) to service_role;
create function public.pitacco_finalize_asaas_customer(p_store uuid,p_customer_id text) returns text language sql security invoker set search_path='' as $$
 select pitacco_private.finalize_asaas_customer(p_store,p_customer_id)
$$;
revoke all on function public.pitacco_finalize_asaas_customer(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_finalize_asaas_customer(uuid,text) to service_role;
