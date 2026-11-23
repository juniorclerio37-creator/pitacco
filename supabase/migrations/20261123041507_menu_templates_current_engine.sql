-- Optional visual template on the current versioned design. Existing stores and
-- older clients keep their design; no orders, prices or published rows change.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('pitacco_private.validate_storefront_design(uuid,jsonb)'::regprocedure);
 if position('Modelo de cardápio inválido' in definition)>0 then return;end if;
 if position('(p_design-allowed_keys)' in definition)=0 then
  raise exception 'Validador visual mudou; revisar antes de aplicar templates';
 end if;
 definition:=replace(definition,'(p_design-allowed_keys)','(p_design-allowed_keys-''template'')');
 definition:=replace(definition,
  ' if p_design->>''theme'' not in',
  ' if p_design ? ''template'' and (jsonb_typeof(p_design->''template'')<>''string'' or p_design->>''template'' not in (''pitacco-v2'',''essencial'',''editorial'',''urbano'')) then
  raise exception ''Modelo de cardápio inválido'';
 end if;
 if p_design->>''theme'' not in');
 if position('Modelo de cardápio inválido' in definition)=0 then
  raise exception 'Não foi possível adicionar validação de template';
 end if;
 execute definition;
end $migration$;
