-- Prepare the existing 15-second push scheduler while keeping the actual
-- dispatch circuit breaker OFF until Firebase OAuth preflight is successful.
-- The job has a WHERE guard that never calls HTTP while settings.enabled=false.
do $$
declare v_job record;
begin
 if not exists(select 1 from pitacco_private.courier_push_settings
    where singleton=true and enabled=false) then
  raise exception 'Refusing scheduler change: push safety switch must be OFF';
 end if;
 select jobid,command into v_job
 from cron.job where jobname='pitacco-courier-push' limit 1;
 if not found then
  raise exception 'Existing courier push scheduler is missing';
 end if;
 if position('where exists(select 1 from pitacco_private.courier_push_settings where enabled)' in
    lower(v_job.command))=0 then
  raise exception 'Courier push scheduler lacks safety switch';
 end if;
 if position('pitacco_push_cron_secret' in v_job.command)=0 then
  raise exception 'Courier push scheduler lacks Vault authorization';
 end if;
 perform cron.alter_job(job_id:=v_job.jobid,active:=true);
end
$$;