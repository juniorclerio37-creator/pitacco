
-- A Flex contract remains chargeable until the instant its Fixo replacement is paid.
alter table pitacco_private.commercial_contracts add column valid_until_at timestamptz;
alter table pitacco_private.commercial_contracts drop constraint commercial_contracts_store_id_effective_from_key;
alter table pitacco_private.commercial_contracts add constraint commercial_contracts_store_day_plan_key unique(store_id,effective_from,plan_code);
alter table pitacco_private.fixo_prepaid_state add column previous_flex_contract uuid references pitacco_private.commercial_contracts(id);
create function pitacco_private.guard_prepaid_request_cancel()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.status in ('cancelled','declined') and old.status is distinct from new.status and exists(
 select 1 from pitacco_private.fixo_prepaid_state s where s.request_id=old.id
 ) then raise exception 'Existe uma fatura de migração. Solicite a conciliação antes de cancelar.';end if;
 return new;
end $$;
revoke all on function pitacco_private.guard_prepaid_request_cancel() from public,anon,authenticated;
create trigger guard_prepaid_request_cancel before update of status on pitacco_private.plan_change_requests for each row execute function pitacco_private.guard_prepaid_request_cancel();
-- The previous Flex contract is retained for historical weekly settlement.
create function pitacco_private.refresh_flex_commission_closings()
returns integer language plpgsql security definer set search_path='' as $$
declare c pitacco_private.commercial_contracts%rowtype; wed date; final_day date;
 st date; lo timestamptz; hi timestamptz; due timestamptz; base bigint; unknown bigint; unfinished bigint; n int:=0;
begin
 for c in select * from pitacco_private.commercial_contracts where plan_code='free' and effective_from<=(now() at time zone 'America/Sao_Paulo')::date loop
  final_day:=(now() at time zone 'America/Sao_Paulo')::date;
  if c.valid_until_at is not null then final_day:=least(final_day,(c.valid_until_at at time zone 'America/Sao_Paulo')::date+7);end if;
  for wed in select g::date from generate_series((c.effective_from+1)::timestamp,final_day::timestamp,interval '1 day') g where extract(isodow from g)=3 loop
   st:=greatest(wed-7,c.effective_from);
   lo:=st::timestamp at time zone 'America/Sao_Paulo';
   hi:=least(wed::timestamp at time zone 'America/Sao_Paulo',coalesce(c.valid_until_at,'infinity'::timestamptz));
   if hi<=lo then continue;end if;
   select coalesce(sum(pitacco_private.commission_product_base(o.receipt)) filter(where o.preparation_status='completed' or exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='entregue')),0),
   count(*) filter(where (o.preparation_status='completed' or exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='entregue')) and pitacco_private.commission_product_base(o.receipt) is null),
   count(*) filter(where coalesce(o.preparation_status,'')<>'completed' and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='entregue'))
   into base,unknown,unfinished
   from public.orders o where o.store_id=c.store_id and o.source='proprio' and o.status in ('pending','accepted')
   and o.created_at>=lo and o.created_at<hi
   and coalesce(o.receipt->>'is_test','false')='false' and coalesce(o.receipt->>'test','false')='false' and coalesce(o.receipt->>'ifood_test','false')='false'
   and not exists(select 1 from public.deliveries d where d.order_id=o.id and d.store_id=o.store_id and d.status='cancelada');
   due:=(wed+time '23:59') at time zone 'America/Sao_Paulo';
   insert into pitacco_private.commercial_closings(contract_id,store_id,kind,period_start,period_end,due_at,grace_until,amount_cents,state,details)
   values(c.id,c.store_id,'commission',st,wed,due,due+interval '48 hours',
   case when unknown+unfinished=0 then round(base::numeric*(c.terms->>'commission_basis_points')::int/10000)::bigint else null end,
   case when unknown+unfinished=0 then 'calculated' else 'review_required' end,
   jsonb_build_object('base_cents',base,'unresolved_orders',unknown,'unfinished_orders',unfinished,'range_start',lo,'range_end',hi,'revision',c.revision))
   on conflict(contract_id,kind,period_end) do update set amount_cents=excluded.amount_cents,state=excluded.state,details=excluded.details,updated_at=now()
   where (commercial_closings.amount_cents,commercial_closings.state,commercial_closings.details) is distinct from (excluded.amount_cents,excluded.state,excluded.details);
   n:=n+1;
  end loop;
 end loop;
 return n;
end $$;
revoke all on function pitacco_private.refresh_flex_commission_closings() from public,anon,authenticated;
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.refresh_commercial_closings()'::regprocedure) into d;
 a:='where cc.effective_from<today and not exists';
 if position(a in d)=0 then raise exception 'Closing refresh changed';end if;
 d:=replace(d,a,'where cc.effective_from<today and cc.plan_code<>''free'' and not exists');
 d:=replace(d,'return n;','return n+pitacco_private.refresh_flex_commission_closings();');
 execute d;
 select pg_get_functiondef('public.pitacco_owner_schedule_commercial_contract(uuid,date,text)'::regprocedure) into d;
 d:=replace(d,'declare r pitacco_private.plan_change_requests%rowtype;','declare prev uuid; r pitacco_private.plan_change_requests%rowtype;');
 a:='if exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=r.store_id) then raise exception ''Já existe contrato comercial; alteração de vigência requer conciliação dos ciclos'' using errcode=''22023'';end if;';
 if position(a in d)=0 then raise exception 'Contract schedule changed';end if;
 d:=replace(d,a,$new$
 select id into prev from pitacco_private.commercial_contracts c where c.store_id=r.store_id and c.plan_code='free' and c.valid_until_at is null and c.effective_from<=today order by c.effective_from desc limit 1;
 if exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=r.store_id) and
    (r.requested_plan<>'complete' or prev is null or exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=r.store_id and c.id<>prev)) then
    raise exception 'Já existe contrato comercial; esta transição requer conciliação dos ciclos' using errcode='22023';
 end if;
 $new$);
 d:=replace(d,'(offer->>''monthly_cents'')::integer<>5990 or (offer->>''commission_basis_points'')::integer<>0','(offer->>''monthly_cents'')::integer is distinct from 5990 or (offer->>''commission_basis_points'')::integer is distinct from 0');
 d:=replace(d,'(contract_id,request_id,first_due_at) values(result,r.id,now())','(contract_id,request_id,first_due_at,previous_flex_contract) values(result,r.id,now(),prev)');
 execute d;
 select pg_get_functiondef('pitacco_private.fixo_prepaid_manual_confirmed()'::regprocedure) into d;
 a:='update pitacco_private.commercial_contracts set effective_from=';
 if position(a in d)=0 then raise exception 'Activation changed';end if;
 d:=replace(d,a,'if st.previous_flex_contract is not null then update pitacco_private.commercial_contracts set valid_until_at=now() where id=st.previous_flex_contract and valid_until_at is null; if not found then raise exception ''Contrato Flex anterior indisponível'';end if; end if; '||a);
 execute d;
 select pg_get_functiondef('public.pitacco_merchant_subscription_details(uuid)'::regprocedure) into d;
 d:=replace(d,'and (fp.contract_id is null or fp.first_trial_grace or fp.activated_at is not null)','and (c.valid_until_at is null or c.valid_until_at>now()) and (fp.contract_id is null or fp.first_trial_grace or fp.activated_at is not null)');
 execute d;
 select pg_get_functiondef('pitacco_private.subscription_state(uuid)'::regprocedure) into d;
 d:=replace(d,'c.plan_code=''free'' and c.effective_from<=','c.plan_code=''free'' and (c.valid_until_at is null or c.valid_until_at>now()) and c.effective_from<=');
 execute d;
 select pg_get_functiondef('pitacco_private.commercial_amount_calculate(uuid,date)'::regprocedure) into d;
 d:=replace(d,'and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=cc.id and fp.activated_at is null)','and (cc.valid_until_at is null or cc.valid_until_at>day::timestamp at time zone ''America/Sao_Paulo'') and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=cc.id and fp.activated_at is null and not fp.first_trial_grace)');
 execute d;
end $patch$;

