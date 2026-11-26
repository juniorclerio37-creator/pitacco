
-- Reuse the existing contract engine without giving merchants administrative privileges.
do $patch$
declare f text; anchor text;
begin
 select pg_get_functiondef('public.pitacco_owner_schedule_commercial_contract(uuid,date,text)'::regprocedure) into f;
 f:=replace(f,'FUNCTION public.pitacco_owner_schedule_commercial_contract(','FUNCTION pitacco_private.schedule_requested_contract(');
 anchor:='if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception ''Sem permissão'' using errcode=''42501'';end if;';
 if strpos(f,anchor)=0 then raise exception 'Contract authorization anchor missing';end if;
 f:=replace(f,anchor,$guard$if auth.uid() is null or not (public.pitacco_is_platform_owner() or exists(select 1 from pitacco_private.plan_change_requests pr where pr.id=p_request and public.is_store_manager(pr.store_id))) then raise exception 'Sem permissão' using errcode='42501';end if;$guard$);
 execute f;
end $patch$;
revoke all on function pitacco_private.schedule_requested_contract(uuid,date,text) from public,anon,authenticated,service_role;
create or replace function public.pitacco_owner_schedule_commercial_contract(p_request uuid,p_effective date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_is_platform_owner() then raise exception 'Sem permissão' using errcode='42501';end if;
 return pitacco_private.schedule_requested_contract(p_request,p_effective,p_reason);
end $$;
create or replace function public.pitacco_merchant_confirm_plan_change(p_store uuid,p_plan text,p_terms text)
returns uuid language plpgsql security definer set search_path='' as $$
declare req uuid; contract uuid; st text; today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 if p_plan is null or p_plan not in ('free','complete') then raise exception 'Plano indisponível';end if;
 perform 1 from public.stores where id=p_store for update;
 if not found then raise exception 'Loja não encontrada';end if;
 -- An already scheduled contract or a paid contract is not a new purchase.
 if exists(select 1 from pitacco_private.commercial_contracts c left join pitacco_private.fixo_prepaid_state fp on fp.contract_id=c.id where c.store_id=p_store and c.plan_code=p_plan and (c.valid_until_at is null or c.valid_until_at>now()) and (fp.contract_id is null or fp.activated_at is not null or fp.first_trial_grace)) then
  select r.id into req from pitacco_private.plan_change_requests r where r.store_id=p_store and r.requested_plan=p_plan and r.status='approved' and r.terms_version=p_terms order by r.created_at desc limit 1;
  if req is not null then return req;end if;
  raise exception 'Este plano já está ativo ou programado';
 end if;
 -- Older paid contracts that are not yet in the commercial ledger need reconciliation.
 if not exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=p_store) and
 (exists(select 1 from pitacco_private.subscription_payments sp where sp.store_id=p_store and sp.paid_until>now()) or exists(select 1 from public.subscriptions s where s.store_id=p_store and s.due_date>today and s.monthly_amount>0)) then
  raise exception 'Existe cobertura anterior a preservar. Solicite conciliação ao suporte antes de migrar.';
 end if;
 req:=public.pitacco_request_plan_change(p_store,p_plan,p_terms);
 select fp.contract_id into contract from pitacco_private.fixo_prepaid_state fp where fp.request_id=req;
 if contract is not null then return req;end if;
 contract:=pitacco_private.schedule_requested_contract(req,today,'Migração automática confirmada pelo gestor da loja');
 -- An immediate Flex contract begins at the actual consent time, not retroactively at midnight.
 if p_plan='free' then
  update pitacco_private.commercial_contracts set valid_from_at=now() where id=contract and valid_from_at is null;
 end if;
 return req;
end $$;
revoke all on function public.pitacco_merchant_confirm_plan_change(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_confirm_plan_change(uuid,text,text) to authenticated;
-- Once a payable invoice exists, keep the original request payable and prevent
-- cancellation/decline from invalidating a late provider confirmation.
create or replace function pitacco_private.guard_prepaid_plan_request() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status in ('cancelled','declined') and old.status in ('pending','in_review') and exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.request_id=old.id) then
  raise exception 'A cobrança de migração já foi emitida. Solicite conciliação ao suporte antes de cancelar.';
 end if;
 return new;
end $$;
drop trigger if exists guard_prepaid_plan_request on pitacco_private.plan_change_requests;
create trigger guard_prepaid_plan_request before update of status on pitacco_private.plan_change_requests for each row execute function pitacco_private.guard_prepaid_plan_request();
revoke all on function pitacco_private.guard_prepaid_plan_request() from public,anon,authenticated;
do $patch$ declare f text; begin
 select pg_get_functiondef('public.pitacco_merchant_plan_options(uuid)'::regprocedure) into f;
 f:=replace(f,'''activation_mode'',''review''','''activation_mode'',''automatic''');
 f:=replace(f,'c.decision_note,c.terms_version,','c.decision_note,c.terms_version,exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.request_id=c.id and fp.activated_at is null) as awaiting_payment,');
 execute f;
end $patch$;
notify pgrst,'reload schema';

