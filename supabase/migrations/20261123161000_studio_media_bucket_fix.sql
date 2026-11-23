-- Estúdio visual: criar destino correto para imagens de loja e de produtos.
-- Regra exclusiva do lojista; leitura pública necessária às imagens do cardápio.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pitacco-media','pitacco-media',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

do $studio$
begin
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='pitacco_media_public_read') then
  create policy pitacco_media_public_read on storage.objects
   for select to public using(bucket_id='pitacco-media');
 end if;
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='pitacco_media_store_manager_insert') then
  create policy pitacco_media_store_manager_insert on storage.objects
   for insert to authenticated
   with check(
    bucket_id='pitacco-media'
    and name ~ '^(stores|products)/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}[.](jpg|png|webp)$'
    and public.is_store_manager(
     case when split_part(name,'/',2) ~ '^[0-9a-fA-F-]{36}$'
      then split_part(name,'/',2)::uuid else null end
    )
   );
 end if;
end $studio$;

-- Backslashes were doubled in the previous Postgres regex, wrongly denying
-- valid .jpg/.png/.webp paths even when a storage upload had succeeded.
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
    or photo !~ '[.](jpg|png|webp)) then
   raise exception 'Imagem fora do armazenamento da loja';
  end if;
 end loop;
 if jsonb_typeof(p_design->'banners')<>'array' or jsonb_array_length(p_design->'banners')>6 then
  raise exception 'Limite de seis banners por loja';
 end if;
 for item in select value from jsonb_array_elements(p_design->'banners') loop
  if jsonb_typeof(item)<>'object' or not (item ?& array['title','subtitle','image_path','starts_at','ends_at','product_id'])
    or item-array['title','subtitle','image_path','starts_at','ends_at','product_id']<>'{}'::jsonb
    or jsonb_typeof(item->'title')<>'string' or length(trim(item->>'title')) not between 2 and 90
    or jsonb_typeof(item->'subtitle')<>'string' or length(item->>'subtitle')>160
    or jsonb_typeof(item->'image_path')<>'string' then raise exception 'Banner incompleto ou inválido'; end if;
  photo:=item->>'image_path';
  if photo<>'' and (length(photo)>300 or left(photo,length('stores/'||p_store||'/'))<>'stores/'||p_store||'/'
   or photo !~ '\.(jpg|png|webp)$') then raise exception 'Imagem de banner de outra loja';end if;
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
) then
   raise exception 'Imagem fora do armazenamento da loja';
  end if;
 end loop;
 if jsonb_typeof(p_design->'banners')<>'array' or jsonb_array_length(p_design->'banners')>6 then
  raise exception 'Limite de seis banners por loja';
 end if;
 for item in select value from jsonb_array_elements(p_design->'banners') loop
  if jsonb_typeof(item)<>'object' or not (item ?& array['title','subtitle','image_path','starts_at','ends_at','product_id'])
    or item-array['title','subtitle','image_path','starts_at','ends_at','product_id']<>'{}'::jsonb
    or jsonb_typeof(item->'title')<>'string' or length(trim(item->>'title')) not between 2 and 90
    or jsonb_typeof(item->'subtitle')<>'string' or length(item->>'subtitle')>160
    or jsonb_typeof(item->'image_path')<>'string' then raise exception 'Banner incompleto ou inválido'; end if;
  photo:=item->>'image_path';
  if photo<>'' and (length(photo)>300 or left(photo,length('stores/'||p_store||'/'))<>'stores/'||p_store||'/'
   or photo !~ '[.](jpg|png|webp)) then raise exception 'Imagem de banner de outra loja';end if;
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
) then raise exception 'Imagem de banner de outra loja';end if;
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


-- Keep definition protected: call only through authorized manager RPC.
revoke all on function pitacco_private.validate_storefront_design(uuid,jsonb) from public,anon,authenticated;
