
alter table pitacco_private.commercial_contracts add column valid_from_at timestamptz;
-- Paid coverage is not forfeited when changing to Flex. The exact paid-through
-- instant is the cutover, and unresolved Fixo invoices prevent scheduling.
create function pitacco_private.schedule_fixo_to_flex(p_contract uuid,p_revision text,p_actor uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare f pitacco_private.fixo_prepaid_state%rowtype; c pitacco_private.commercial_contracts%rowtype;
 offer jsonb; result uuid; cutoff timestamptz;
begin
 select * into f from pitacco_private.fixo_prepaid_state where contract_id=p_contract for update;
 if not found or f.activated_at is null or f.paid_until is null then raise exception 'A mudança para o Flex exige conciliação do primeiro pagamento ou teste';end if;
 select * into c from pitacco_private.commercial_contracts where id=p_contract for update;
 if c.plan_code is distinct from 'complete' or c.valid_until_at is not null then raise exception 'Contrato Fixo indisponível para migração';end if;
 if exists(select 1 from pitacco_private.commercial_invoices i left join pitacco_private.commercial_manual_payments m on m.invoice_id=i.id where i.contract_id=c.id and m.invoice_id is null) then raise exception 'Existe fatura Fixo em aberto. Concilie antes de alterar o plano.';end if;
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision=p_revision and x->>'code'='free' and coalesce((x->>'available')::boolean,true);
 if offer is null or (offer->>'monthly_cents')::int is distinct from 0 or (offer->>'commission_basis_points')::int is distinct from 500 or (offer->>'trial_days')::int is distinct from 0 then raise exception 'Condições do Flex indisponíveis';end if;
 cutoff:=greatest(now(),f.paid_until);
 if exists(select 1 from pitacco_private.commercial_contracts cc where cc.store_id=c.store_id and cc.id<>c.id and cc.valid_until_at is null) then raise exception 'Outra transição comercial está pendente';end if;
 update pitacco_private.commercial_contracts set valid_until_at=cutoff where id=c.id;
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,valid_from_at,terms,assigned_by)
 values(c.store_id,p_revision,'free',(cutoff at time zone 'America/Sao_Paulo')::date,cutoff,offer,p_actor) returning id into result;
 return result;
end $$;
revoke all on function pitacco_private.schedule_fixo_to_flex(uuid,text,uuid) from public,anon,authenticated;
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('public.pitacco_owner_schedule_commercial_contract(uuid,date,text)'::regprocedure) into d;
 d:=replace(d,'declare prev uuid;','declare prev uuid; current_fixo uuid; cutover timestamptz;');
 a:='select id into prev from pitacco_private.commercial_contracts';
 if position(a in d)=0 then raise exception 'Contract schedule changed';end if;
 d:=replace(d,a,$new$
 if r.requested_plan='free' then
  select c.id into current_fixo from pitacco_private.commercial_contracts c join pitacco_private.fixo_prepaid_state fp on fp.contract_id=c.id
   where c.store_id=r.store_id and c.valid_until_at is null and c.plan_code='complete' and fp.activated_at is not null order by c.effective_from desc limit 1;
  if current_fixo is not null then
   result:=pitacco_private.schedule_fixo_to_flex(current_fixo,r.terms_version,auth.uid());
   select valid_from_at into cutover from pitacco_private.commercial_contracts where id=result;
   update pitacco_private.plan_change_requests set status='approved',updated_at=now(),decided_by=auth.uid(),decision_note='Flex programado para '||to_char(cutover at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||', ao término da cobertura paga.' where id=r.id;
   insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(r.store_id,auth.uid(),'fixo_to_flex_scheduled',jsonb_build_object('contract_id',result,'request_id',r.id,'cutover',cutover,'reason',p_reason));
   return result;
  end if;
 end if;
 $new$||a);
 d:=replace(d,'and c.id<>prev))','and c.id<>prev and (c.valid_until_at is null or c.valid_until_at>now())))');
 d:=replace(d,'and c.valid_until_at is null and c.effective_from<=today','and c.valid_until_at is null and (c.valid_from_at is null or c.valid_from_at<=now()) and c.effective_from<=today');
 execute d;
 select pg_get_functiondef('pitacco_private.ensure_fixo_prepaid_invoice(uuid)'::regprocedure) into d;
 a:='select * into c from pitacco_private.commercial_contracts where id=p_contract;';
 if position(a in d)=0 then raise exception 'Invoice guard changed';end if;
 execute replace(d,a,a||' if c.valid_until_at is not null then return null;end if;');
 select pg_get_functiondef('pitacco_private.subscription_state(uuid)'::regprocedure) into d;
 d:=replace(d,'and c.effective_from<=','and (c.valid_from_at is null or c.valid_from_at<=now()) and c.effective_from<=');
 d:=replace(d,'where cc.store_id=store.id and fp.activated_at is not null','where cc.store_id=store.id and (cc.valid_until_at is null or cc.valid_until_at>now()) and fp.activated_at is not null');
 execute d;
 select pg_get_functiondef('pitacco_private.commercial_orders_blocked(uuid)'::regprocedure) into d;
 d:=replace(d,'where c.store_id=p_store and fp.activated_at is not null','where c.store_id=p_store and (c.valid_until_at is null or c.valid_until_at>now()) and fp.activated_at is not null');
 execute d;
 select pg_get_functiondef('public.pitacco_merchant_subscription_details(uuid)'::regprocedure) into d;
 d:=replace(d,'and (c.valid_until_at is null or c.valid_until_at>now())','and (c.valid_until_at is null or c.valid_until_at>now()) and (c.valid_from_at is null or c.valid_from_at<=now())');
 execute d;
 select pg_get_functiondef('pitacco_private.refresh_flex_commission_closings()'::regprocedure) into d;
 d:=replace(d,'lo:=st::timestamp at time zone ''America/Sao_Paulo'';','lo:=greatest(st::timestamp at time zone ''America/Sao_Paulo'',c.valid_from_at);');
 execute d;
 select pg_get_functiondef('public.pitacco_store_subscription_status(uuid)'::regprocedure) into d;
 d:=replace(d,'''orders_blocked'',(state.status=''suspended'' or','''orders_blocked'',(pitacco_private.commercial_orders_blocked(p_store) or state.status=''suspended'' or');
 execute d;
 select pg_get_functiondef('pitacco_private.run_commercial_billing()'::regprocedure) into d;
 d:=replace(d,'perform pitacco_private.refresh_commercial_closings();',$new$
 update public.subscriptions sub set monthly_amount=0,status='ativa',due_date=null,updated_at=now()
 where exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=sub.store_id and c.plan_code='free' and c.valid_from_at<=now() and (c.valid_until_at is null or c.valid_until_at>now()))
 and (sub.monthly_amount is distinct from 0 or sub.due_date is not null);
 perform pitacco_private.refresh_commercial_closings();
 $new$);
 execute d;
end $patch$;

