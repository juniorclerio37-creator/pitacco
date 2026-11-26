-- Normalize both the legacy and production email validators; preserve all data and permissions.
do $migration$
declare definition text; old_definition text; prefix text := '^[^@[:space:]]+@[^@[:space:]]+'; suffix text := '.[^@[:space:]]+$';
begin
 select pg_get_functiondef('public.pitacco_save_store_registration(uuid,jsonb)'::regprocedure) into definition;
 old_definition:=definition;
 definition:=replace(definition,prefix||chr(92)||chr(92)||suffix,prefix||'[.][^@[:space:]]+$');
 definition:=replace(definition,prefix||chr(92)||suffix,prefix||'[.][^@[:space:]]+$');
 if definition=old_definition and position(prefix||'[.][^@[:space:]]+$' in definition)=0 then raise exception 'Expected registration email validator missing';end if;
 execute definition;
end $migration$;
