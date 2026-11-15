create table pitacco_private.platform_owner (
  singleton boolean primary key default true check(singleton),
  user_id uuid unique not null references auth.users(id)
);
revoke all on pitacco_private.platform_owner from public,anon,authenticated;

-- Keep the existing confirmed administrator only if the choice is unambiguous.
insert into pitacco_private.platform_owner(singleton,user_id)
select true,candidate.id from (
  select profile.id,count(*) over() as total
  from public.profiles profile join auth.users account on account.id=profile.id
  where profile.role='admin' and account.email_confirmed_at is not null
) candidate where candidate.total=1;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(select 1 from pitacco_private.platform_owner where user_id=(select auth.uid()))
$function$;

create table pitacco_private.store_feature_rules (
 id bigint generated always as identity primary key,
 store_id uuid references public.stores(id) on delete cascade,
 feature text not null,
 enabled boolean not null,
 unique nulls not distinct(store_id,feature)
);
create table pitacco_private.store_feature_audit (
 id bigint generated always as identity primary key,
 store_id uuid,
 feature text not null,
 enabled boolean,
 changed_by uuid not null,
 changed_at timestamptz not null default now()
);
revoke all on pitacco_private.store_feature_rules,pitacco_private.store_feature_audit from public,anon,authenticated;

create function pitacco_private.allowed_store_features()
returns text[] language sql immutable set search_path='' as $function$
 select array['alertas','estoque','cardapio','clientes','fideliza','financeiro','caixa','relatorios','motoboys','integracoes','agendamento']::text[]
$function$;
revoke all on function pitacco_private.allowed_store_features() from public,anon,authenticated;

create function public.pitacco_store_features(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
 if auth.uid() is null or p_store is null or not public.can_access_store(p_store) then raise exception 'Acesso à loja indisponível';end if;
 select jsonb_object_agg(features.feature,coalesce(specific.enabled,platform.enabled,true)) into result
 from unnest(pitacco_private.allowed_store_features()) features(feature)
 left join pitacco_private.store_feature_rules platform on platform.store_id is null and platform.feature=features.feature
 left join pitacco_private.store_feature_rules specific on specific.store_id=p_store and specific.feature=features.feature;
 return result;
end;
$function$;

create function public.pitacco_owner_feature_settings(p_store uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Acesso exclusivo do proprietário do Pitacco';end if;
 select jsonb_object_agg(features.feature,jsonb_build_object('default_enabled',coalesce(platform.enabled,true),'override',specific.enabled)) into result
 from unnest(pitacco_private.allowed_store_features()) features(feature)
 left join pitacco_private.store_feature_rules platform on platform.store_id is null and platform.feature=features.feature
 left join pitacco_private.store_feature_rules specific on specific.store_id=p_store and specific.feature=features.feature;
 return result;
end;
$function$;

create function public.pitacco_owner_set_feature(p_store uuid,p_feature text,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $function$
begin
 if not public.is_admin() then raise exception 'Acesso exclusivo do proprietário do Pitacco';end if;
 if p_feature is null or not(p_feature=any(pitacco_private.allowed_store_features())) then raise exception 'Módulo indisponível';end if;
 if p_enabled is null then
  delete from pitacco_private.store_feature_rules where store_id is not distinct from p_store and feature=p_feature;
 else
  insert into pitacco_private.store_feature_rules(store_id,feature,enabled)
   values(p_store,p_feature,p_enabled) on conflict (store_id,feature) do update set enabled=excluded.enabled;
 end if;
 insert into pitacco_private.store_feature_audit(store_id,feature,enabled,changed_by)
 values(p_store,p_feature,p_enabled,auth.uid());
end;
$function$;
revoke all on function public.pitacco_store_features(uuid),public.pitacco_owner_feature_settings(uuid),
 public.pitacco_owner_set_feature(uuid,text,boolean) from public,anon;
grant execute on function public.pitacco_store_features(uuid),public.pitacco_owner_feature_settings(uuid),
 public.pitacco_owner_set_feature(uuid,text,boolean) to authenticated;
