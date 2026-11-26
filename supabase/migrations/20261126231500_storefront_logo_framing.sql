-- Optional logo framing is versioned with appearance; existing designs remain valid.
DO $patch$
DECLARE f text;
BEGIN
 SELECT pg_get_functiondef('pitacco_private.validate_storefront_design(uuid,jsonb)'::regprocedure) INTO f;
 IF strpos(f,'-''logo_frame''')>0 THEN RETURN; END IF;
 IF strpos(f,$anchor$(p_design-allowed_keys-'template')$anchor$)=0 THEN RAISE EXCEPTION 'Logo framing validator anchor missing'; END IF;
 f:=replace(f,$anchor$(p_design-allowed_keys-'template')$anchor$,$replacement$(p_design-allowed_keys-'template'-'logo_frame')$replacement$);
 IF strpos(f,$anchor$ foreach key in array array['primary'$anchor$)=0 THEN RAISE EXCEPTION 'Logo framing validation anchor missing'; END IF;
 f:=replace(f,$anchor$ foreach key in array array['primary'$anchor$,$replacement$ if p_design ? 'logo_frame' then
  item:=p_design->'logo_frame';
  if jsonb_typeof(item) is distinct from 'object' or not (item ?& array['size','zoom','x','y','padding','fit','shape'])
   or (item-array['size','zoom','x','y','padding','fit','shape'])<>'{}'::jsonb then
    raise exception 'Enquadramento do logotipo inválido';
  end if;
  foreach key in array array['size','zoom','x','y','padding'] loop
   if jsonb_typeof(item->key) is distinct from 'number' then raise exception 'Enquadramento do logotipo inválido';end if;
  end loop;
  if (item->>'size')::numeric not between 80 and 140 or (item->>'zoom')::numeric not between 100 and 250
   or (item->>'x')::numeric not between -50 and 50 or (item->>'y')::numeric not between -50 and 50
   or (item->>'padding')::numeric not between 0 and 20
   or jsonb_typeof(item->'fit') is distinct from 'string' or item->>'fit' not in ('contain','cover')
   or jsonb_typeof(item->'shape') is distinct from 'string' or item->>'shape' not in ('default','circle','rounded') then
    raise exception 'Enquadramento do logotipo inválido';
  end if;
 end if;
 foreach key in array array['primary'$replacement$);
 EXECUTE f;
END $patch$;
NOTIFY pgrst,'reload schema';
