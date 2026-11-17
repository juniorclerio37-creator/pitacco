-- Studio visual: configurações por loja, rascunhos isolados e publicação versionada.
create table public.pitacco_storefront_designs (
 store_id uuid primary key references public.stores(id) on delete cascade,
 draft jsonb not null default '{}'::jsonb,
 published jsonb,
 draft_version integer not null default 0 check (draft_version>=0),
 published_version integer not null default 0 check (published_version>=0),
 updated_at timestamptz not null default now(),
 published_at timestamptz
);
alter table public.pitacco_storefront_designs enable row level security;
revoke all on public.pitacco_storefront_designs from public,anon,authenticated;

create table public.pitacco_storefront_design_versions (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 version integer not null check(version>=1),
 snapshot jsonb not null,
 published_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(store_id,version)
);
create index pitacco_storefront_design_versions_recent on public.pitacco_storefront_design_versions(store_id,version desc);
alter table public.pitacco_storefront_design_versions enable row level security;
revoke all on public.pitacco_storefront_design_versions from public,anon,authenticated;

create function pitacco_private.storefront_design_default(p_store uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
  'theme','moderno',
  'primary',coalesce((select primary_color from public.store_customer_branding where store_id=p_store),'#ca4936'),
  'secondary',coalesce((select secondary_color from public.store_customer_branding where store_id=p_store),'#655068'),
  'background','#f8f5f6','paper','#ffffff','foreground','#281e29',
  'hero','#30202e','highlight','#fff0e8',
  'layout','lista','radius',20,'font','sistema','photo_size','medio',
  'show_descriptions',true,'slogan','Cardápio digital',
  'instagram','','logo_path','','cover_path','','banners','[]'::jsonb)
$$;
revoke all on function pitacco_private.storefront_design_default(uuid) from public,anon,authenticated;

create function pitacco_private.validate_storefront_design(p_store uuid,p_design jsonb)
returns void language plpgsql stable set search_path='' as $$
declare key text; photo text; item jsonb; start_at timestamptz; end_at timestamptz;
 allowed_keys text[]:=array['theme','primary','secondary','background','paper','foreground','hero','highlight',
  'layout','radius','font','photo_size','show_descriptions','slogan','instagram','logo_path','cover_path','banners'];
begin
 if p_design is null or jsonb_typeof(p_design)<>'object'
  or not(p_design ?& allowed_keys) or (p_design-allowed_keys)<>'{}'::jsonb then
  raise exception 'Configuração visual incompleta ou não permitida';
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
    or photo !~ '\.(jpg|png|webp)$') then
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
end $$;
revoke all on function pitacco_private.validate_storefront_design(uuid,jsonb) from public,anon,authenticated;

create function public.pitacco_storefront_studio_state(p_store uuid)
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
  'draft',case when found then null end,'placeholder',null
 );
end $$;
