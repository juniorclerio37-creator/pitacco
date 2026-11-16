
alter table pitacco_private.homologation_results
 drop constraint homologation_results_scope_check,
 add constraint homologation_results_scope_check check (scope in ('asaas','marketplaces','repasse','pedidos','entregas','whatsapp','windows','publicacao','mercado_pago','pagbank','infinitepay','99food_acesso','99food_vinculo','99food_recebimento','99food_andamento','99food_entrega_propria','99food_entrega_plataforma'));
create index homologation_results_99food_history on pitacco_private.homologation_results(store_id,id desc)
 where left(scope,7)='99food_';

create or replace function public.pitacco_admin_record_homologation(p_store uuid,p_scope text,p_outcome text,p_notes text,p_request uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare recorded bigint; existing pitacco_private.homologation_results%rowtype;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo da administração do Pitacco'; end if;
 if p_request is null or p_scope is null or p_scope not in ('asaas','marketplaces','repasse','pedidos','entregas','whatsapp','windows','publicacao','mercado_pago','pagbank','infinitepay','99food_acesso','99food_vinculo','99food_recebimento','99food_andamento','99food_entrega_propria','99food_entrega_plataforma')
   or p_outcome is null or p_outcome not in ('approved','failed','pending')
   or p_notes is null or char_length(btrim(p_notes)) not between 3 and 1200 then
  raise exception 'Informe o teste, o resultado e uma observação de 3 a 1200 caracteres';
 end if;
 if left(p_scope,7)='99food_' and p_store is null then
  raise exception 'Selecione a loja Pitacco usada no teste da 99Food' using errcode='22023';
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
end $$;

create or replace function public.pitacco_admin_homologation_results()
returns table(id bigint,store_id uuid,store_name text,scope text,outcome text,notes text,recorded_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Acesso exclusivo da administração do Pitacco'; end if;
 return query
  select result.id,result.store_id,store.name,result.scope,result.outcome,result.notes,result.recorded_at
  from pitacco_private.homologation_results result
  left join public.stores store on store.id=result.store_id
  where left(result.scope,7)<>'99food_'
  order by result.id desc limit 50;
end $$;

create function public.pitacco_owner_99food_homologation(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare stage_results jsonb; history jsonb;
begin
 if not public.pitacco_is_platform_owner() then
  raise exception 'Acesso exclusivo do proprietário do Pitacco' using errcode='42501';
 end if;
 if p_store is null or not exists(select 1 from public.stores s where s.id=p_store) then
  raise exception 'Selecione a loja Pitacco usada no teste da 99Food' using errcode='22023';
 end if;
 select coalesce(jsonb_object_agg(r.scope,r.outcome),'{}'::jsonb) into stage_results from (
  select distinct on (h.scope) h.scope,h.outcome
  from pitacco_private.homologation_results h
  where h.store_id=p_store and left(h.scope,7)='99food_'
  order by h.scope,h.id desc
 ) r;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc),'[]'::jsonb) into history from (
  select h.id,h.scope,h.outcome,h.notes,h.recorded_at
  from pitacco_private.homologation_results h
  where h.store_id=p_store and left(h.scope,7)='99food_'
  order by h.id desc limit 30
 ) r;
 return jsonb_build_object('stages',stage_results,'history',history);
end $$;
revoke all on function public.pitacco_owner_99food_homologation(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_99food_homologation(uuid) to authenticated;
