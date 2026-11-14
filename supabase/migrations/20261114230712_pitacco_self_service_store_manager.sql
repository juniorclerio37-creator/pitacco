-- The signup RPC owns membership creation. Give the verified owner management
-- rights only in the new store that the same transaction just created.
do $migration$
declare
  definition text := pg_get_functiondef('public.pitacco_register_store(text,text)'::regprocedure);
  before constant text := $sql$values(v_store,v_uid,'lojista');$sql$;
  after constant text := $sql$values(v_store,v_uid,'gestor');$sql$;
begin
  if strpos(definition, after) > 0 then
    return;
  end if;
  if strpos(definition, before) = 0 then
    raise exception 'O cadastro de lojas difere da versão de referência';
  end if;
  execute replace(definition, before, after);
end;
$migration$;
