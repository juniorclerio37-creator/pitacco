-- Existing trial deadlines and subscription records are preserved.
do $migration$
declare
  definition text := pg_get_functiondef('public.pitacco_register_store(text,text)'::regprocedure);
begin
  if strpos(definition, 'current_date+7)') = 0 or strpos(definition, 'now()+interval ''7 days''') = 0 then
    if strpos(definition, 'current_date+30)') = 0 or strpos(definition, 'now()+interval ''30 days''') = 0 then
      raise exception 'O cadastro de lojas difere da versão de referência';
    end if;
    execute replace(replace(definition, 'current_date+30)', 'current_date+7)'), 'now()+interval ''30 days''', 'now()+interval ''7 days''');
  end if;
end;
$migration$;

alter table public.pitacco_signup_trials alter column ends_at set default (now() + interval '7 days');
alter table public.subscriptions alter column monthly_amount set default 59.90;
