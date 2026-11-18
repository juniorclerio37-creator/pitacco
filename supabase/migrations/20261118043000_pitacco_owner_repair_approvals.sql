-- Pitacco Intelligence 3: one explicitly approved and reversible correction.
-- Only an existing disabled store order alert may be re-enabled. No changes to
-- Android courier push, Windows printing, payment, orders or marketplaces.
create table pitacco_private.intelligence_repair_proposals (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 kind text not null check (kind='enable_store_order_sound'),
 status text not null default 'proposed'
  check (status in ('proposed','applied','reverted','rejected')),
 expected_enabled boolean not null default false check (expected_enabled=false),
 expected_volume integer not null check (expected_volume between 0 and 100),
 expected_updated_at timestamptz not null,
 applied_updated_at timestamptz,
 created_by uuid not null references auth.users(id),
 applied_by uuid references auth.users(id),
 reverted_by uuid references auth.users(id),
 rejected_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 applied_at timestamptz,
 reverted_at timestamptz,
 rejected_at timestamptz
);
create unique index intelligence_one_active_repair_per_store
 on pitacco_private.intelligence_repair_proposals(store_id,kind)
 where status in ('proposed','applied');
create index intelligence_repair_recent on pitacco_private.intelligence_repair_proposals(created_at desc);

create table pitacco_private.intelligence_repair_audit (
 id bigint generated always as identity primary key,
 proposal_id uuid not null references pitacco_private.intelligence_repair_proposals(id) on delete restrict,
 actor uuid not null references auth.users(id),
 action text not null check (action in ('proposed','applied','reverted','rejected')),
 previous_enabled boolean,
 next_enabled boolean,
 created_at timestamptz not null default now()
);
revoke all on pitacco_private.intelligence_repair_proposals
 from public,anon,authenticated;
revoke all on pitacco_private.intelligence_repair_audit
 from public,anon,authenticated;

create function public.pitacco_owner_repair_propose(p_store uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=(select auth.uid());
 setting record;
 proposal_id uuid;
begin
 if actor is null or not public.pitacco_is_platform_owner() then
  raise exception 'Correções exclusivas do Super Admin' using errcode='42501';
 end if;
 if p_store is null then raise exception 'Selecione uma loja'; end if;

 -- Serialize proposals for the same store against its existing settings row.
 select enabled,volume,updated_at into setting
 from public.pitacco_store_sound_settings
 where store_id=p_store for update;
 if not found then
  raise exception 'A loja não possui configuração de som salva. Configure primeiro no painel da loja.';
 end if;
 if setting.enabled then raise exception 'O som de pedidos da loja já está habilitado'; end if;
 if exists(select 1 from pitacco_private.intelligence_repair_proposals p
  where p.store_id=p_store and p.kind='enable_store_order_sound'
    and p.status in ('proposed','applied')) then
  raise exception 'Já existe uma correção aberta para esta loja';
 end if;
 insert into pitacco_private.intelligence_repair_proposals
  (store_id,kind,expected_volume,expected_updated_at,created_by)
 values (p_store,'enable_store_order_sound',setting.volume,setting.updated_at,actor)
 returning id into proposal_id;
 insert into pitacco_private.intelligence_repair_audit
  (proposal_id,actor,action,previous_enabled,next_enabled)
 values (proposal_id,actor,'proposed',false,false);
 return jsonb_build_object('id',proposal_id,'status','proposed','executed',false);
end $$;

create function public.pitacco_owner_repair_decide(p_proposal uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=(select auth.uid());
 proposal pitacco_private.intelligence_repair_proposals%rowtype;
 setting record;
 changed_at timestamptz;
 next_status text;
 previous_state boolean;
 next_state boolean;
begin
 if actor is null or not public.pitacco_is_platform_owner() then
  raise exception 'Correções exclusivas do Super Admin' using errcode='42501';
 end if;
 if p_proposal is null or p_action not in ('apply','revert','reject') then
  raise exception 'Operação de correção inválida';
 end if;
 select * into proposal from pitacco_private.intelligence_repair_proposals p
 where p.id=p_proposal for update;
 if not found then raise exception 'Proposta inexistente';end if;
 if p_action in ('apply','reject') and proposal.status<>'proposed' then
  raise exception 'Esta proposta não está mais aguardando aprovação';
 end if;
 if p_action='revert' and proposal.status<>'applied' then
  raise exception 'Somente correções aplicadas podem ser revertidas';
 end if;
 select enabled,volume,updated_at into setting
 from public.pitacco_store_sound_settings
 where store_id=proposal.store_id for update;
 if not found then raise exception 'Configuração de som não está mais disponível';end if;
 if p_action='apply' then
  if setting.enabled is distinct from false or
    setting.volume is distinct from proposal.expected_volume or
    setting.updated_at is distinct from proposal.expected_updated_at then
    raise exception 'Configuração alterada desde a proposta. Rejeite e gere uma nova proposta';
  end if;
  changed_at:=clock_timestamp();
  update public.pitacco_store_sound_settings set enabled=true,updated_at=changed_at
   where store_id=proposal.store_id;
  update pitacco_private.intelligence_repair_proposals set
   status='applied',applied_by=actor,applied_at=changed_at,applied_updated_at=changed_at
   where id=p_proposal;
  next_status:='applied';previous_state:=false;next_state:=true;
 elsif p_action='revert' then
  if setting.enabled is distinct from true or
    setting.volume is distinct from proposal.expected_volume or
    setting.updated_at is distinct from proposal.applied_updated_at then
    raise exception 'A configuração mudou após a correção. Reversão automática bloqueada para preservar alterações recentes';
  end if;
  changed_at:=clock_timestamp();
  update public.pitacco_store_sound_settings set enabled=false,updated_at=changed_at
    where store_id=proposal.store_id;
  update pitacco_private.intelligence_repair_proposals set
   status='reverted',reverted_by=actor,reverted_at=changed_at
   where id=p_proposal;
  next_status:='reverted';previous_state:=true;next_state:=false;
 else
  update pitacco_private.intelligence_repair_proposals set
   status='rejected',rejected_by=actor,rejected_at=clock_timestamp()
   where id=p_proposal;
  next_status:='rejected';previous_state:=setting.enabled;next_state:=setting.enabled;
 end if;
 insert into pitacco_private.intelligence_repair_audit
  (proposal_id,actor,action,previous_enabled,next_enabled)
 values (p_proposal,actor,
  case p_action when 'apply' then 'applied' when 'revert' then 'reverted' else 'rejected' end,
  previous_state,next_state);
 return jsonb_build_object('id',p_proposal,'status',next_status,
  'executed',p_action in ('apply','revert'));
end $$;

create function public.pitacco_owner_repairs(p_store uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.pitacco_is_platform_owner() then
  raise exception 'Histórico exclusivo do Super Admin' using errcode='42501';
 end if;
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc)
    from (select p.id,p.store_id,s.name as store_name,p.kind,p.status,
     p.expected_volume,p.created_at,p.applied_at,p.reverted_at,p.rejected_at
     from pitacco_private.intelligence_repair_proposals p
     join public.stores s on s.id=p.store_id
     where p_store is null or p.store_id=p_store
     order by p.created_at desc,p.id desc limit 30) r),'[]'::jsonb),
  'eligible',case when p_store is null then false else exists(
    select 1 from public.pitacco_store_sound_settings ss
    where ss.store_id=p_store and not ss.enabled
      and not exists(select 1 from pitacco_private.intelligence_repair_proposals p
        where p.store_id=p_store and p.kind='enable_store_order_sound'
          and p.status in ('proposed','applied'))
  ) end,
  'selected_sound',case when p_store is null then null else
   (select jsonb_build_object('configured',true,'enabled',ss.enabled,'volume',ss.volume)
     from public.pitacco_store_sound_settings ss where ss.store_id=p_store) end
 ) into result;
 return result;
end $$;

revoke all on function public.pitacco_owner_repair_propose(uuid) from public,anon,authenticated;
revoke all on function public.pitacco_owner_repair_decide(uuid,text) from public,anon,authenticated;
revoke all on function public.pitacco_owner_repairs(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_owner_repair_propose(uuid) to authenticated;
grant execute on function public.pitacco_owner_repair_decide(uuid,text) to authenticated;
grant execute on function public.pitacco_owner_repairs(uuid) to authenticated;
