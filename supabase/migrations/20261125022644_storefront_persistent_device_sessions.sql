create table pitacco_private.customer_device_sessions(
 store_id uuid not null references public.stores(id) on delete cascade,
 device_hash text not null check(device_hash ~ '^[0-9a-f]{64}$'),
 phone text check(phone ~ '^[0-9]{10,11}$'),
 expires_at timestamptz not null, revoked_at timestamptz, updated_at timestamptz not null default now(),
 primary key(store_id,device_hash),
 check(phone is not null or revoked_at is not null)
);
alter table pitacco_private.customer_device_sessions enable row level security;
revoke all on pitacco_private.customer_device_sessions from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.pitacco_v2_customer_profile(p_slug text, p_phone text, p_device text, p_action text DEFAULT 'load'::text, p_name text DEFAULT NULL::text, p_addresses jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid; normalized text; digest text; customer public.pitacco_v2_customer_profiles%rowtype;
 clean_addresses jsonb:='[]'::jsonb; address_item jsonb; label text;
 v_street text;v_number text;v_neighborhood text;v_city text;v_state text;v_postal text;v_extra text;
 v_name text; session_row pitacco_private.customer_device_sessions%rowtype;
begin
 normalized:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if left(normalized,2)='55' and length(normalized) in (12,13) then normalized:=substr(normalized,3);end if;
 if normalized !~ '^[0-9]{10,11}$' or coalesce(p_device,'') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
 then return jsonb_build_object('found',false,'error','Identificação inválida');end if;
 select m.store_id into sid from public.public_menu_settings m where m.slug=p_slug and m.enabled limit 1;
 if sid is null then return jsonb_build_object('found',false,'error','Cardápio indisponível');end if;
 digest:=encode(sha256(convert_to(p_device,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(sid::text||digest,0));
 select * into session_row from pitacco_private.customer_device_sessions where store_id=sid and device_hash=digest;
 if found and (session_row.revoked_at is not null or session_row.expires_at<=now() or session_row.phone is distinct from normalized) then
  return jsonb_build_object('found',false,'error','Sessão encerrada. Identifique-se novamente.','session_reset',true);
 end if;
 select * into customer from public.pitacco_v2_customer_profiles
 where store_id=sid and phone=normalized and device_hash=digest for update;
 if p_action='load' then
  if not found then return jsonb_build_object('found',false,'addresses','[]'::jsonb);end if;
  return jsonb_build_object('found',true,'name',customer.name,'addresses',customer.addresses);
 end if;
 if p_action<>'save' then return jsonb_build_object('error','Ação inválida');end if;
 v_name:=btrim(coalesce(p_name,''));
 if length(v_name) not between 2 and 120 then return jsonb_build_object('error','Nome inválido');end if;
 if p_addresses is null then
  clean_addresses:=case when found then customer.addresses else '[]'::jsonb end;
 else
  if jsonb_typeof(p_addresses)<>'array' or jsonb_array_length(p_addresses)>8 then
   return jsonb_build_object('error','Endereços inválidos');end if;
  for address_item in select value from jsonb_array_elements(p_addresses) loop
   if jsonb_typeof(address_item)<>'object' then return jsonb_build_object('error','Endereço inválido');end if;
   label:=left(btrim(coalesce(address_item->>'label','Casa')),24);
   v_street:=left(btrim(coalesce(address_item->>'street','')),100);
   v_number:=left(btrim(coalesce(address_item->>'number','')),20);
   v_neighborhood:=left(btrim(coalesce(address_item->>'neighborhood','')),60);
   v_city:=left(btrim(coalesce(address_item->>'city','')),60);
   v_state:=upper(btrim(coalesce(address_item->>'state','')));
   v_postal:=regexp_replace(coalesce(address_item->>'postal',''),'[^0-9]','','g');
   v_extra:=left(btrim(coalesce(address_item->>'extra','')),100);
   if length(v_street)<3 or length(v_number)<1 or length(v_neighborhood)<2
    or length(v_city)<2 or v_state !~ '^[A-Z]{2}$' or length(v_postal) not in (0,8)
   then return jsonb_build_object('error','Preencha o endereço completo');end if;
   clean_addresses:=clean_addresses||jsonb_build_array(jsonb_build_object(
    'id',case when coalesce(address_item->>'id','') ~ '^[0-9a-f-]{36}$' then address_item->>'id' else gen_random_uuid()::text end,
    'label',case when label='' then 'Casa' else label end,
    'street',v_street,'number',v_number,'neighborhood',v_neighborhood,
    'city',v_city,'state',v_state,'postal',v_postal,'extra',v_extra,
    'is_default',coalesce((address_item->>'is_default')::boolean,false)
   ));
  end loop;
 end if;
 insert into public.pitacco_v2_customer_profiles(store_id,phone,device_hash,name,addresses)
 values(sid,normalized,digest,v_name,clean_addresses)
 on conflict(store_id,phone,device_hash)
 do update set name=excluded.name,addresses=excluded.addresses,updated_at=now()
 returning * into customer;
 insert into pitacco_private.customer_device_sessions(store_id,device_hash,phone,expires_at)
 values(sid,digest,normalized,now()+interval '90 days')
 on conflict(store_id,device_hash) do update set expires_at=excluded.expires_at,updated_at=now();
 return jsonb_build_object('found',true,'name',customer.name,'addresses',customer.addresses,'session_active',true);
end $function$
;
create function public.pitacco_customer_device_session(p_slug text,p_device text,p_action text default 'resume')
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; digest text; s pitacco_private.customer_device_sessions%rowtype; c public.pitacco_v2_customer_profiles%rowtype;
begin
 if coalesce(p_device,'') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then return jsonb_build_object('active',false,'reset',true);end if;
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled limit 1;
 if sid is null then return jsonb_build_object('active',false);end if;
 digest:=encode(sha256(convert_to(p_device,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(sid::text||digest,0));
 if p_action='logout' then
  insert into pitacco_private.customer_device_sessions(store_id,device_hash,phone,expires_at,revoked_at)
  values(sid,digest,null,now(),now())
  on conflict(store_id,device_hash) do update set revoked_at=now(),updated_at=now();
  return jsonb_build_object('active',false,'reset',true);
 end if;
 if p_action<>'resume' then return jsonb_build_object('active',false,'error','Ação inválida');end if;
 select * into s from pitacco_private.customer_device_sessions where store_id=sid and device_hash=digest;
 if not found then return jsonb_build_object('active',false);end if;
 if s.revoked_at is not null or s.expires_at<=now() then return jsonb_build_object('active',false,'reset',true);end if;
 select * into c from public.pitacco_v2_customer_profiles where store_id=sid and device_hash=digest and phone=s.phone;
 if not found then return jsonb_build_object('active',false,'reset',true);end if;
 if s.expires_at<now()+interval '89 days' then
  update pitacco_private.customer_device_sessions set expires_at=now()+interval '90 days',updated_at=now() where store_id=sid and device_hash=digest returning * into s;
 end if;
 return jsonb_build_object('active',true,'phone',s.phone,'name',c.name,'addresses',c.addresses,'expires_at',s.expires_at);
end $$;
revoke all on function public.pitacco_customer_device_session(text,text,text) from public;
grant execute on function public.pitacco_customer_device_session(text,text,text) to anon,authenticated;;
