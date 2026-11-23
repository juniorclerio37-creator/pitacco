-- Preserva as imagens preexistentes da loja no Estúdio (gestores apenas).
-- Permite banners somente com imagem, mantendo a validação de caminho e loja.
create or replace function public.pitacco_storefront_studio_state(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row public.pitacco_storefront_designs%rowtype; versions jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem acesso ao estúdio da loja' using errcode='42501';end if;
 select * into row from public.pitacco_storefront_designs where store_id=p_store;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'created_at',v.created_at)
  order by v.version desc),'[]'::jsonb) into versions
 from (select * from public.pitacco_storefront_design_versions where store_id=p_store order by version desc limit 20) v;
 return jsonb_build_object(
  'draft',coalesce(row.draft,pitacco_private.storefront_design_default(p_store)),
  'published',row.published,
  'draft_version',coalesce(row.draft_version,0),
  'published_version',coalesce(row.published_version,0),
  'updated_at',row.updated_at,'published_at',row.published_at,
  'legacy_logo_url',(select b.logo_url from public.store_customer_branding b where b.store_id=p_store),
  'legacy_banner_url',(select b.banner_url from public.store_customer_branding b where b.store_id=p_store),
  'history',versions);
end $$;

CREATE OR REPLACE FUNCTION pitacco_private.validate_storefront_design(p_store uuid, p_design jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare key text; photo text; item jsonb; start_at timestamptz; end_at timestamptz;
 allowed_keys text[]:=array['theme','primary','secondary','background','paper','foreground','hero','highlight',
  'layout','radius','font','photo_size','show_descriptions','slogan','instagram','logo_path','cover_path','banners'];
begin
 if p_design is null or jsonb_typeof(p_design)<>'object'
  or not(p_design ?& allowed_keys) or (p_design-allowed_keys-'template')<>'{}'::jsonb then
  raise exception 'Configuração visual incompleta ou não permitida';
 end if;
 if p_design ? 'template' and (jsonb_typeof(p_design->'template')<>'string' or p_design->>'template' not in ('pitacco-v2','essencial','editorial','urbano')) then
  raise exception 'Modelo de cardápio inválido';
 end if;
 if p_design->>'theme' not in ('moderno','premium','minimalista','colorido')
  or p_design->>'layout' not in ('lista','grade','destaques')
  or p_design->>'font' not in ('sistema','arredondada','serifada')
  or p_design->>'photo_size' not in ('pequeno','medio','grande')
  or jsonb_typeof(p_design->'show_descriptions')<>'boolean'
  or jsonb_typeof(p_design->'radius')<>'number'
  or (p_design->>'radius')::numeric not between 0 and 32 then
  raise exception 'Modelo ou layout inválido';
 end if;
 foreach key in array array['primary','secondary','background','paper','foreground','hero','highlight'] loop
  if jsonb_typeof(p_design->key)<>'string' or (p_design->>key) !~ '^#[0-9A-Fa-f]{6}$' then
   raise exception 'Cor % inválida',key;
  end if;
 end loop;
 if jsonb_typeof(p_design->'slogan')<>'string' or length(p_design->>'slogan')>100
   or jsonb_typeof(p_design->'instagram')<>'string'
   or (p_design->>'instagram'<>'' and (p_design->>'instagram') !~ '^@[A-Za-z0-9._]{1,30}$') then
  raise exception 'Slogan ou Instagram inválido';
 end if;
 foreach key in array array['logo_path','cover_path'] loop
  if jsonb_typeof(p_design->key)<>'string' then raise exception 'Imagem inválida';end if;
  photo:=p_design->>key;
  if photo<>'' and (length(photo)>300 or left(photo,length('stores/'||p_store||'/'))<>'stores/'||p_store||'/'
    or photo !~ '[.](jpg|png|webp)$') then
   raise exception 'Imagem fora do armazenamento da loja';
  end if;
 end loop;
 if jsonb_typeof(p_design->'banners')<>'array' or jsonb_array_length(p_design->'banners')>6 then
  raise exception 'Limite de seis banners por loja';
 end if;
 for item in select value from jsonb_array_elements(p_design->'banners') loop
  if jsonb_typeof(item)<>'object' or not (item ?& array['title','subtitle','image_path','starts_at','ends_at','product_id'])
    or item-array['title','subtitle','image_path','starts_at','ends_at','product_id']<>'{}'::jsonb
    or jsonb_typeof(item->'title')<>'string'
    or (length(trim(item->>'title')) not between 2 and 90
     and not (trim(item->>'title')='' and nullif(item->>'image_path','') is not null))
    or jsonb_typeof(item->'subtitle')<>'string' or length(item->>'subtitle')>160
    or jsonb_typeof(item->'image_path')<>'string' then raise exception 'Banner incompleto ou inválido'; end if;
  photo:=item->>'image_path';
  if photo<>'' and (length(photo)>300 or left(photo,length('stores/'||p_store||'/'))<>'stores/'||p_store||'/'
   or photo !~ '[.](jpg|png|webp)$') then raise exception 'Imagem de banner de outra loja';end if;
  if jsonb_typeof(item->'product_id') not in ('null','string') then raise exception 'Produto do banner inválido'; end if;
  if coalesce(item->>'product_id','')<>'' then
   if (item->>'product_id') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Produto do banner inválido';end if;
   if not exists(select 1 from public.products where id=(item->>'product_id')::uuid and store_id=p_store) then
    raise exception 'Produto do banner não pertence à loja';end if;
  end if;
  if jsonb_typeof(item->'starts_at') not in ('null','string') or jsonb_typeof(item->'ends_at') not in ('null','string')
   then raise exception 'Data do banner inválida'; end if;
  begin
   start_at:=nullif(item->>'starts_at','')::timestamptz;
   end_at:=nullif(item->>'ends_at','')::timestamptz;
  exception when others then raise exception 'Data do banner inválida';end;
  if start_at is not null and end_at is not null and end_at<=start_at then
   raise exception 'A data final deve ser posterior à inicial';
  end if;
 end loop;
end $function$
;
