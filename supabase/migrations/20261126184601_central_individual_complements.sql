-- One store-local complement identity per normalized name; group-specific prices and option IDs stay intact.
create table if not exists pitacco_private.complement_registry (
 store_id uuid not null references public.stores(id) on delete cascade,
 name_key text not null check(length(name_key) between 1 and 100),
 display_name text not null,
 blocked boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(store_id,name_key)
);
alter table pitacco_private.complement_registry enable row level security;
revoke all on pitacco_private.complement_registry from public,anon,authenticated;
create or replace function pitacco_private.complement_name_key(p_name text)
returns text language sql immutable strict set search_path='' as $$
 select lower(regexp_replace(btrim(p_name),'[[:space:]]+',' ','g'))
$$;
revoke all on function pitacco_private.complement_name_key(text) from public,anon,authenticated;
-- Initial registration does not edit any existing availability, price, group or image.
insert into pitacco_private.complement_registry(store_id,name_key,display_name)
select store_id,k,min(name) from (
 select store_id,name,pitacco_private.complement_name_key(name) k from public.product_options
 union all
 select t.store_id,x->>'name',pitacco_private.complement_name_key(x->>'name') from public.pitacco_complement_templates t cross join lateral jsonb_array_elements(t.options) x
) src where length(k) between 1 and 100 group by store_id,k on conflict do nothing;
create or replace function pitacco_private.register_complement(p_store uuid,p_name text)
returns boolean language plpgsql security definer set search_path='' as $$
declare k text:=pitacco_private.complement_name_key(p_name); v_blocked boolean;
begin
 if k is null or length(k) not between 1 and 100 then return false;end if;
 insert into pitacco_private.complement_registry(store_id,name_key,display_name) values(p_store,k,btrim(p_name)) on conflict do nothing;
 select blocked into v_blocked from pitacco_private.complement_registry where store_id=p_store and name_key=k for share;
 return coalesce(v_blocked,false);
end $$;
revoke all on function pitacco_private.register_complement(uuid,text) from public,anon,authenticated;
create or replace function pitacco_private.complement_register_option()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if pitacco_private.register_complement(new.store_id,new.name) then new.available:=false;end if;
 return new;
end $$;
revoke all on function pitacco_private.complement_register_option() from public,anon,authenticated;
drop trigger if exists central_complement_register_option on public.product_options;
create trigger central_complement_register_option before insert or update of name,available,store_id on public.product_options for each row execute function pitacco_private.complement_register_option();
create or replace function pitacco_private.complement_register_template()
returns trigger language plpgsql security definer set search_path='' as $$
declare x jsonb; opts jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(new.options) is distinct from 'array' then return new;end if;
 for x in select value from jsonb_array_elements(new.options) loop
  if pitacco_private.register_complement(new.store_id,x->>'name') then x:=jsonb_set(x,'{available}','false'::jsonb,true);end if;
  opts:=opts||jsonb_build_array(x);
 end loop;
 new.options:=opts;
 return new;
end $$;
revoke all on function pitacco_private.complement_register_template() from public,anon,authenticated;
drop trigger if exists central_complement_register_template on public.pitacco_complement_templates;
create trigger central_complement_register_template before insert or update of options,store_id on public.pitacco_complement_templates for each row execute function pitacco_private.complement_register_template();
create or replace function public.pitacco_central_complement_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store) then raise exception 'Sem autorização nesta loja' using errcode='42501';end if;
 with actual as (
  select pitacco_private.complement_name_key(o.name) k,o.name,g.product_id,g.name group_name,o.additional_price price,o.available
  from public.product_options o join public.product_option_groups g on g.id=o.group_id and g.store_id=o.store_id
  left join public.pitacco_complement_templates t on t.id=g.library_template_id and t.store_id=g.store_id
  where o.store_id=p_store and g.enabled is not false and
  (o.library_option_id is null or g.library_template_id is null or exists(select 1 from jsonb_array_elements(t.options) x where x->>'id'=o.library_option_id::text))
 ), template_options as (
  select pitacco_private.complement_name_key(x->>'name') k,x->>'name' name,null::uuid product_id,t.name group_name,(x->>'price')::numeric price,coalesce((x->>'available')::boolean,true) available
  from public.pitacco_complement_templates t cross join lateral jsonb_array_elements(t.options) x where t.store_id=p_store
 ), combined as (select * from actual union all select * from template_options),
 stats as (select k,min(name) name,count(*) filter(where product_id is not null) links,count(distinct product_id) products,
 array_agg(distinct group_name order by group_name) groups,array_agg(distinct price order by price) prices,
 bool_and(available) all_available,bool_or(available) any_available from combined where length(k) between 1 and 100 group by k)
 select coalesce(jsonb_agg(jsonb_build_object('key',s.k,'name',s.name,'links',s.links,'products',s.products,'groups',s.groups,'prices',s.prices,'blocked',coalesce(r.blocked,false),'state',case when coalesce(r.blocked,false) then 'blocked' when s.all_available then 'available' when s.any_available then 'mixed' else 'unavailable' end) order by s.name),'[]'::jsonb) into result
 from stats s left join pitacco_private.complement_registry r on r.store_id=p_store and r.name_key=s.k;
 return result;
end $$;
revoke all on function public.pitacco_central_complement_list(uuid) from public,anon;
grant execute on function public.pitacco_central_complement_list(uuid) to authenticated;
create or replace function public.pitacco_central_complement_availability(p_store uuid,p_name_key text,p_available boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare affected int; k text:=pitacco_private.complement_name_key(p_name_key);
begin
 if auth.uid() is null or not pitacco_private.can_edit_catalog(p_store) then raise exception 'Sem autorização nesta loja' using errcode='42501';end if;
 if p_available is null or k is null or k<>p_name_key then raise exception 'Complemento inválido';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,4141));
 if not exists(select 1 from public.product_options o where o.store_id=p_store and pitacco_private.complement_name_key(o.name)=k)
 and not exists(select 1 from public.pitacco_complement_templates t cross join lateral jsonb_array_elements(t.options) x where t.store_id=p_store and pitacco_private.complement_name_key(x->>'name')=k) then raise exception 'Complemento não encontrado nesta loja';end if;
 update pitacco_private.complement_registry set blocked=not p_available,updated_at=now() where store_id=p_store and name_key=k;
 if not found then raise exception 'Cadastro central não encontrado';end if;
 update public.pitacco_complement_templates t set options=(select jsonb_agg(case when pitacco_private.complement_name_key(x.value->>'name')=k then jsonb_set(x.value,'{available}',to_jsonb(p_available),true) else x.value end order by x.ordinality) from jsonb_array_elements(t.options) with ordinality x),updated_at=now()
 where t.store_id=p_store and exists(select 1 from jsonb_array_elements(t.options) x where pitacco_private.complement_name_key(x->>'name')=k);
 update public.product_options o set available=p_available
 where o.store_id=p_store and pitacco_private.complement_name_key(o.name)=k and o.available is distinct from p_available
 and (not p_available or exists(select 1 from public.product_option_groups g left join public.pitacco_complement_templates t on t.id=g.library_template_id and t.store_id=g.store_id where g.id=o.group_id and g.store_id=p_store and g.enabled is not false and (o.library_option_id is null or g.library_template_id is null or exists(select 1 from jsonb_array_elements(t.options) x where x->>'id'=o.library_option_id::text))));
 get diagnostics affected=row_count;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'central_complement_availability',jsonb_build_object('name_key',k,'available',p_available,'affected_options',affected));
 return jsonb_build_object('saved',true,'affected_options',affected,'available',p_available);
end $$;
revoke all on function public.pitacco_central_complement_availability(uuid,text,boolean) from public,anon;
grant execute on function public.pitacco_central_complement_availability(uuid,text,boolean) to authenticated;
