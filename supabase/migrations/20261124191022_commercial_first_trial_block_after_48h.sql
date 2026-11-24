
-- Keep activation controlled until actual provider settlement has been verified.
-- Scope the first-trial enforcement to accepted Fixo contracts only.
do $patch$
declare d text; a text;
begin
 select pg_get_functiondef('pitacco_private.commercial_orders_blocked(uuid)'::regprocedure) into d;
 a:='and exists(select 1 from pitacco_private.commercial_invoices i';
 if position(a in d)=0 then raise exception 'Commercial guard changed';end if;
 d:=replace(d,a,$new$
 and (exists(select 1 from pitacco_private.fixo_prepaid_state fp join pitacco_private.commercial_contracts c on c.id=fp.contract_id
   left join pitacco_private.subscription_admin_controls a on a.store_id=c.store_id
   where c.store_id=p_store and c.plan_code='complete' and fp.first_trial_grace and fp.activated_at is null
   and (c.valid_until_at is null or c.valid_until_at>now())
   and now()>=greatest(fp.first_due_at,a.trial_extension_until)+interval '48 hours')
 or exists(select 1 from pitacco_private.commercial_invoices i
 $new$);
 d:=replace(d,'=''overdue''))','=''overdue'')))');
 execute d;
 select pg_get_functiondef('public.pitacco_store_commercial_block_status(uuid)'::regprocedure) into d;
 a:='where b.store_id=p_store and p.invoice_id is null';
 if position(a in d)=0 then raise exception 'Commercial notice changed';end if;
 d:=replace(d,a,'where b.store_id=p_store and not exists(select 1 from pitacco_private.fixo_prepaid_state fp where fp.contract_id=i.contract_id and fp.activated_at is null and not fp.first_trial_grace) and p.invoice_id is null');
 execute d;
end $patch$;

