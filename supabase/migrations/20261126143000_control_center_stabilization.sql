-- Control Center: use the established commercial rules, without changing billing or blocking.
-- Abort if either existing function has drifted; never overwrite an unknown implementation.
do $patch$
declare d text; official text; status_expr text; old_rows text; old_receivables text; new_receivables text;
begin
 select pg_get_functiondef('public.pitacco_commercial_invoices(uuid,integer)'::regprocedure) into official;
 status_expr:=substring(official from 'case when pitacco_private[.]asaas_current_resolution[(]i[.]id[)][^;]+?end as status');
 if status_expr is null or strpos(status_expr,'i.grace_until')=0 or strpos(status_expr,'review_required')=0 or strpos(status_expr,'recovery_due')=0 then
  raise exception 'Official billing status expression not found';
 end if;
 old_rows:=$old$case when p.invoice_id is not null then 'paid' when i.due_at<now() then 'overdue' else 'open' end as status$old$;
 select pg_get_functiondef('public.pitacco_control_rows(text,uuid,integer,text)'::regprocedure) into d;
 if strpos(d,old_rows)>0 then execute replace(d,old_rows,status_expr);
 elsif strpos(d,status_expr)=0 then raise exception 'Control Center charges patch anchor not found'; end if;
 -- Keep existing receivable/forecast amounts unchanged; only use official status for overdue.
 old_receivables:=$old$receivables as(select i.amount_cents,i.due_at from pitacco_private.commercial_invoices i left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id where p.invoice_id is null)$old$;
 new_receivables:='receivables as(select i.amount_cents,i.due_at,'||status_expr||' from pitacco_private.commercial_invoices i join pitacco_private.commercial_closings b using(contract_id,kind,period_end) left join pitacco_private.commercial_manual_payments p on p.invoice_id=i.id where p.invoice_id is null)';
 select pg_get_functiondef('public.pitacco_control_dashboard(date,date)'::regprocedure) into d;
 if strpos(d,old_receivables)>0 and strpos(d,$old$filter(where due_at<now())$old$)>0 then
  execute replace(replace(d,old_receivables,new_receivables),$old$filter(where due_at<now())$old$,$new$filter(where status='overdue')$new$);
 elsif strpos(d,new_receivables)=0 or strpos(d,$new$filter(where status='overdue')$new$)=0 then raise exception 'Control Center dashboard patch anchors not found'; end if;
end $patch$;
create index if not exists control_audit_store_idx on pitacco_private.control_audit(store_id);
create index if not exists control_lifecycle_store_idx on pitacco_private.control_lifecycle(store_id);
create index if not exists control_notices_store_idx on pitacco_private.control_notices(store_id);
create index if not exists control_windows_sessions_store_idx on pitacco_private.control_windows_sessions(store_id);

-- Verification: canonical status boundaries and preserved privileges.
do $verify$
begin
 assert pitacco_private.commercial_invoice_status(100,100,'calculated',false,now()+interval '1 hour',now()+interval '49 hours')='open';
 assert pitacco_private.commercial_invoice_status(100,100,'calculated',false,now()-interval '1 hour',now()+interval '47 hours')='grace';
 assert pitacco_private.commercial_invoice_status(100,100,'calculated',false,now()-interval '49 hours',now()-interval '1 hour')='overdue';
 assert pitacco_private.commercial_invoice_status(100,100,'calculated',true,now()-interval '49 hours',now()-interval '1 hour')='paid';
 assert pitacco_private.commercial_invoice_status(100,99,'calculated',false,now(),now())='review_required';
 assert not has_function_privilege('anon','public.pitacco_control_rows(text,uuid,integer,text)','EXECUTE');
 assert not has_function_privilege('anon','public.pitacco_control_dashboard(date,date)','EXECUTE');
 assert not has_function_privilege('authenticated','public.pitacco_control_record_observation(text,text,text,text,integer)','EXECUTE');
end $verify$;
