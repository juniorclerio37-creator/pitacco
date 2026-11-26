-- Narrow internal health probe. It does not attest HTTP, marketplaces, printing or push.
create or replace function pitacco_private.control_database_heartbeat()
returns void language plpgsql set search_path='' as $heartbeat$
begin
 perform 1 from public.stores limit 1;
 perform public.pitacco_control_record_observation('database','operational',
  'Consulta interna ao cadastro central concluída; não verifica a API externa.',
  'pg_cron · consulta interna PostgreSQL',300);
end $heartbeat$;
revoke all on function pitacco_private.control_database_heartbeat() from public,anon,authenticated;
select pitacco_private.control_database_heartbeat();
do $schedule$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('pitacco-control-database-health','*/2 * * * *',
   'select pitacco_private.control_database_heartbeat()');
 end if;
end $schedule$;
