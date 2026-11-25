
do $patch$ declare f text;begin
select pg_get_functiondef('public.pitacco_track_public_order(uuid)'::regprocedure) into f;
if position('''delivery_service'',case' in f)=0 then
 f:=replace(f,'''payment_method'',o.receipt->>''payment''','''payment_method'',o.receipt->>''payment'',''delivery_service'',case when o.source=''proprio'' and o.receipt->>''delivery_service''=''priority'' then ''priority'' else ''standard'' end');
 execute f;
end if;
end $patch$;
-- Use existing per-store dispatch mode; manual-mode stores remain untouched.
do $cron$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  if not exists(select 1 from cron.job where jobname='pitacco-geographic-auto-dispatch') then
   perform cron.schedule('pitacco-geographic-auto-dispatch','15 seconds','select pitacco_private.group_auto_tick()');
  end if;
 end if;
end $cron$;

