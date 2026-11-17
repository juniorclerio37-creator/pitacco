-- Surface the hours configuration in the guided readiness checklist.
-- Do not change entitlement or previously valid published stores.
do $patch$
declare definition text;
 marker constant text:='''checkout_configuration'',case when checkout_rules then ''ok'' else ''action'' end,';
begin
 definition:=pg_get_functiondef('public.pitacco_store_launch_diagnostic(uuid)'::regprocedure);
 if strpos(definition,'''opening_hours'',case when exists(')>0 then return;end if;
 if strpos(definition,marker)=0 then raise exception 'Preflight diagnostic format changed';end if;
 execute replace(definition,marker,
  '''opening_hours'',case when exists(select 1 from public.pitacco_store_hours h where h.store_id=p_store and h.manager_configured) then ''ok'' else ''action'' end,'
  ||chr(10)||'  '||marker);
end $patch$;
