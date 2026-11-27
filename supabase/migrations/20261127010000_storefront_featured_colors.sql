-- Optional visual settings only: no migration of stores or changes to orders.
DO $patch$
DECLARE f text;
BEGIN
 SELECT pg_get_functiondef('pitacco_private.validate_storefront_design(uuid,jsonb)'::regprocedure) INTO f;
 IF strpos(f,'-''featured_colors''')>0 THEN RETURN; END IF;
 IF strpos(f,$anchor$(p_design-allowed_keys-'template'-'logo_frame')$anchor$)=0 THEN RAISE EXCEPTION 'Featured colors validator anchor missing'; END IF;
 f:=replace(f,$anchor$(p_design-allowed_keys-'template'-'logo_frame')$anchor$,$replacement$(p_design-allowed_keys-'template'-'logo_frame'-'featured_colors')$replacement$);
 IF strpos(f,$anchor$ foreach key in array array['primary'$anchor$)=0 THEN RAISE EXCEPTION 'Featured colors validation anchor missing'; END IF;
 f:=replace(f,$anchor$ foreach key in array array['primary'$anchor$,$replacement$ if p_design ? 'featured_colors' then
  item:=p_design->'featured_colors';
  if jsonb_typeof(item) is distinct from 'object' or (item-array['background','border','price','badge','button'])<>'{}'::jsonb then
   raise exception 'Cores dos destaques inválidas';
  end if;
  foreach key in array array['background','border','price','badge','button'] loop
   if item ? key and (jsonb_typeof(item->key) is distinct from 'string' or (item->>key) !~ '^#[0-9A-Fa-f]{6}$') then
    raise exception 'Cores dos destaques inválidas';
   end if;
  end loop;
 end if;
 foreach key in array array['primary'$replacement$);
 EXECUTE f;
END $patch$;
NOTIFY pgrst,'reload schema';
