
create table if not exists pitacco_private.ifood_central_requests (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 merchant_id uuid not null,
 requested_by uuid not null,
 state text not null default 'pending' check(state in ('pending','awaiting','active','rejected')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reviewed_by uuid,
 provider_name text,
 unique(store_id,merchant_id)
);
alter table pitacco_private.ifood_central_requests enable row level security;
revoke all on pitacco_private.ifood_central_requests from public,anon,authenticated;
create or replace function public.pitacco_ifood_central_request(p_store uuid,p_merchant uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão para gerenciar esta loja' using errcode='42501'; end if;
 if not coalesce((select merchant_linking from pitacco_private.ifood_control),false) then raise exception 'Integração ainda não liberada'; end if;
 if p_merchant is null or exists(select 1 from pitacco_private.ifood_merchants where store_id=p_store and test_only) then raise exception 'Solicitação disponível apenas para produção'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ifood:'||p_merchant::text,0));
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja indisponível'; end if;
 if exists(select 1 from pitacco_private.ifood_merchants where merchant_id=p_merchant and (store_id<>p_store or test_only or credential is not null)) then raise exception 'Merchant ID indisponível; contate o suporte'; end if;
 if exists(select 1 from pitacco_private.ifood_merchants where merchant_id=p_merchant and store_id=p_store and enabled) then raise exception 'Esta conta já está habilitada'; end if;
 if (select count(*) from pitacco_private.ifood_central_requests where store_id=p_store and state in ('pending','awaiting') and merchant_id<>p_merchant)>=3 then raise exception 'Limite de solicitações pendentes atingido'; end if;
 insert into pitacco_private.ifood_central_requests(store_id,merchant_id,requested_by)
 values(p_store,p_merchant,auth.uid())
 on conflict(store_id,merchant_id) do update set
 state=case when ifood_central_requests.state='rejected' then 'pending' else ifood_central_requests.state end,
 updated_at=now(), requested_by=excluded.requested_by
 returning id into v_id;
 return v_id;
end $$;
create or replace function public.pitacco_ifood_central_requests(p_store uuid)
returns table(id uuid,merchant_id uuid,state text,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501'; end if;
 return query select r.id,r.merchant_id,r.state,r.created_at,r.updated_at from pitacco_private.ifood_central_requests r where r.store_id=p_store order by r.created_at desc;
end $$;
create or replace function public.pitacco_owner_ifood_central_requests()
returns table(id uuid,store_id uuid,store_name text,merchant_id uuid,state text,created_at timestamptz,updated_at timestamptz,provider_name text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501'; end if;
 return query select r.id,r.store_id,s.name::text,r.merchant_id,r.state,r.created_at,r.updated_at,r.provider_name from pitacco_private.ifood_central_requests r join public.stores s on s.id=r.store_id order by case when r.state in ('pending','awaiting') then 0 else 1 end,r.created_at desc limit 200;
end $$;
create or replace function public.pitacco_owner_ifood_central_review(p_request uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501'; end if;
 if p_action not in ('awaiting','rejected') then raise exception 'Ação inválida'; end if;
 update pitacco_private.ifood_central_requests set state=p_action,reviewed_by=auth.uid(),updated_at=now() where id=p_request and state in ('pending','awaiting');
 if not found then raise exception 'Solicitação indisponível'; end if;
end $$;
create or replace function public.pitacco_ifood_central_approve(p_request uuid,p_actor uuid,p_merchant uuid,p_provider_name text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r pitacco_private.ifood_central_requests%rowtype; existing pitacco_private.ifood_merchants%rowtype;
begin
 if not exists(select 1 from pitacco_private.platform_owner where user_id=p_actor) then raise exception 'Sem permissão' using errcode='42501'; end if;
 if not coalesce((select merchant_linking from pitacco_private.ifood_control),false) then raise exception 'Integração pausada'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ifood:'||p_merchant::text,0));
 select * into r from pitacco_private.ifood_central_requests where id=p_request and merchant_id=p_merchant and state='awaiting' for update;
 if not found then raise exception 'Solicitação indisponível'; end if;
 perform 1 from public.stores where id=r.store_id for update;
 if not found then raise exception 'Loja indisponível'; end if;
 if not exists(select 1 from public.store_members where store_id=r.store_id and user_id=r.requested_by and role='gestor') and not exists(select 1 from pitacco_private.platform_owner where user_id=r.requested_by) then raise exception 'Solicitante não é mais gestor da loja'; end if;
 select * into existing from pitacco_private.ifood_merchants where merchant_id=p_merchant;
 if found then
  if existing.store_id<>r.store_id or existing.test_only or existing.credential is not null then raise exception 'Merchant ID indisponível'; end if;
  update pitacco_private.ifood_merchants set enabled=true where merchant_id=p_merchant;
 else
  if (select count(*) from pitacco_private.ifood_merchants where store_id=r.store_id)>=3 then raise exception 'Limite de contas atingido'; end if;
  insert into pitacco_private.ifood_merchants(merchant_id,store_id,test_only,enabled,credential) values(p_merchant,r.store_id,false,true,null);
 end if;
 update pitacco_private.ifood_central_requests set state='active',reviewed_by=p_actor,provider_name=left(p_provider_name,200),updated_at=now() where id=p_request;
 return true;
end $$;
revoke all on function public.pitacco_ifood_central_request(uuid,uuid),public.pitacco_ifood_central_requests(uuid),public.pitacco_owner_ifood_central_requests(),public.pitacco_owner_ifood_central_review(uuid,text),public.pitacco_ifood_central_approve(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_central_request(uuid,uuid),public.pitacco_ifood_central_requests(uuid),public.pitacco_owner_ifood_central_requests(),public.pitacco_owner_ifood_central_review(uuid,text) to authenticated;
grant execute on function public.pitacco_ifood_central_approve(uuid,uuid,uuid,text) to service_role;
-- Stop new distributed production links, preserve test and existing connections.
create or replace function public.pitacco_ifood_begin_auth(p_actor uuid,p_store uuid,p_merchant uuid,p_test boolean,p_verifier text,p_seconds integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare ref uuid;
begin
 if not p_test then raise exception 'Use a solicitação centralizada iFood'; end if;
 if p_seconds not between 1 and 600 or length(p_verifier) not between 12 and 16000 then raise exception 'Autorização inválida'; end if;
 insert into pitacco_private.ifood_authorizations(actor,store_id,merchant_id,test_only,verifier,expires_at)
 values(p_actor,p_store,p_merchant,p_test,p_verifier,now()+make_interval(secs=>p_seconds))
 on conflict(actor,store_id) do update set id=excluded.id,merchant_id=excluded.merchant_id,test_only=excluded.test_only,verifier=excluded.verifier,expires_at=excluded.expires_at returning id into ref;
 return ref;
end $$;
delete from pitacco_private.ifood_authorizations where not test_only;
