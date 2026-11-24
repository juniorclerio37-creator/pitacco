
-- Explicit plan acceptance at registration; no changes to pre-existing stores.
alter table pitacco_private.fixo_prepaid_state add column first_trial_grace boolean not null default false;
create function public.pitacco_register_store_plan(p_name text,p_document text,p_plan text,p_revision text)
returns table(store_id uuid,trial_ends_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s uuid; e timestamptz; c uuid; offer jsonb; rev text; existing boolean;
begin
 if u is null then raise exception 'Autenticação necessária';end if;
 if p_plan is null or p_plan not in ('free','complete') then raise exception 'Escolha o plano';end if;
 perform pg_advisory_xact_lock(hashtextextended('pitacco-signup:'||u::text,0));
 select revision into rev from public.pitacco_plan_catalog_signal where singleton for share;
 if p_revision is distinct from rev then raise exception 'Os planos foram atualizados. Recarregue e confirme as condições.';end if;
 select x into offer from pitacco_private.plan_catalog_versions v cross join lateral jsonb_array_elements(v.plans) x where v.revision=rev and x->>'code'=p_plan and coalesce((x->>'available')::boolean,true);
 if offer is null then raise exception 'Plano indisponível';end if;
 if p_plan='free' and ((offer->>'monthly_cents')::int<>0 or (offer->>'commission_basis_points')::int<>500 or (offer->>'trial_days')::int<>0) then raise exception 'Condições do Flex divergentes';end if;
 if p_plan='complete' and ((offer->>'monthly_cents')::int<>5990 or (offer->>'commission_basis_points')::int<>0 or (offer->>'trial_days')::int<>15 or (offer->>'first_payment_grace_hours')::int is distinct from 48) then raise exception 'Condições do Fixo divergentes';end if;
 select exists(select 1 from public.pitacco_signup_trials t where t.user_id=u) into existing;
 select r.store_id,r.trial_ends_at into s,e from public.pitacco_register_store(p_name,p_document) r;
 if existing then return query select s,e;return;end if;
 if p_plan='free' then
  update public.pitacco_signup_trials t set ends_at=started_at where t.first_store_id=s;
  update public.subscriptions sub set monthly_amount=0,status='ativa',due_date=null,updated_at=now() where sub.store_id=s;
  e:=null;
 else
  offer:=offer||jsonb_build_object('prepaid',true);
 end if;
 insert into pitacco_private.commercial_contracts(store_id,revision,plan_code,effective_from,terms,assigned_by)
 values(s,rev,p_plan,(now() at time zone 'America/Sao_Paulo')::date,offer,u) returning id into c;
 if p_plan='complete' then
  insert into pitacco_private.fixo_prepaid_state(contract_id,first_due_at,first_trial_grace) values(c,e,true);
 end if;
 insert into pitacco_private.subscription_admin_audit(store_id,actor_id,action,details) values(s,u,'commercial_signup',jsonb_build_object('contract_id',c,'plan',p_plan,'revision',rev));
 return query select s,e;
end $$;
revoke all on function public.pitacco_register_store_plan(text,text,text,text) from public,anon;
grant execute on function public.pitacco_register_store_plan(text,text,text,text) to authenticated;
-- First invoice is generated on the local date of trial expiry, not earlier.
-- Renewals are prepared three days before expiry, with no grace.
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.ensure_fixo_prepaid_invoice(uuid)'::regprocedure) into d;
 a:='if v_due>now()+interval ''3 days'' then return null;end if;';
 if position(a in d)=0 then raise exception 'Invoice schedule changed';end if;
 d:=replace(d,a,$new$
 if st.first_trial_grace and st.activated_at is null then
   select greatest(st.first_due_at,admin.trial_extension_until) into v_due from public.stores s
   left join pitacco_private.subscription_admin_controls admin on admin.store_id=s.id where s.id=c.store_id;
   if (v_due at time zone 'America/Sao_Paulo')::date>(now() at time zone 'America/Sao_Paulo')::date then return null;end if;
 elsif v_due>now()+interval '3 days' then return null;end if;
 $new$);
 d:=replace(d,'v_start,v_end,v_due,v_due,5990','v_start,v_end,v_due,case when st.first_trial_grace and st.activated_at is null then v_due+interval ''48 hours'' else v_due end,5990');
 d:=replace(d,'v_end,5990,v_due,v_due)','v_end,5990,v_due,case when st.first_trial_grace and st.activated_at is null then v_due+interval ''48 hours'' else v_due end)');
 execute d;
 select pg_get_functiondef('pitacco_private.fixo_prepaid_manual_confirmed()'::regprocedure) into d;
 a:='v_end:=pitacco_private.fixo_prepaid_next_end(now(),st.paid_until);';
 if position(a in d)=0 then raise exception 'Payment activation changed';end if;
 d:=replace(d,a,'v_end:=pitacco_private.fixo_prepaid_next_end(now(),case when st.first_trial_grace and st.activated_at is null then greatest(st.first_due_at,(select trial_extension_until from pitacco_private.subscription_admin_controls where store_id=c.store_id)) else st.paid_until end);');
 execute d;
 select pg_get_functiondef('pitacco_private.subscription_state(uuid)'::regprocedure) into d;
 a:='when payment.paid_until>now() then ''active''';
 if position(a in d)=0 then raise exception 'Subscription state changed';end if;
 d:=replace(d,a,'when exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=store.id and c.plan_code=''free'' and c.effective_from<=(now() at time zone ''America/Sao_Paulo'')::date) then ''active'' '||a);
 d:=replace(d,'case when prepaid.contract_id is not null then null else greatest(trial.ends_at,admin.trial_extension_until) end','case when prepaid.contract_id is not null or exists(select 1 from pitacco_private.commercial_contracts c where c.store_id=store.id and c.plan_code=''free'' and c.effective_from<=(now() at time zone ''America/Sao_Paulo'')::date) then null else greatest(trial.ends_at,admin.trial_extension_until) end');
 execute d;
 select pg_get_functiondef('public.pitacco_merchant_subscription_details(uuid)'::regprocedure) into d;
 a:='''plan_code'',s.plan';
 if position(a in d)=0 then raise exception 'Merchant plan label changed';end if;
 d:=replace(d,a,'''plan_code'',coalesce((select c.plan_code from pitacco_private.commercial_contracts c left join pitacco_private.fixo_prepaid_state fp on fp.contract_id=c.id where c.store_id=s.id and c.effective_from<=(now() at time zone ''America/Sao_Paulo'')::date and (fp.contract_id is null or fp.first_trial_grace or fp.activated_at is not null) order by c.effective_from desc limit 1),s.plan)');
 execute d;
end $patch$;

