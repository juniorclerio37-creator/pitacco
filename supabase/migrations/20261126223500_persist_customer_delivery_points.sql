-- Keep validated delivery coordinates in the device-scoped customer profile.
-- Never guess missing coordinates for existing profiles.
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
 saved_address jsonb; prior_address jsonb; saved_text text; saved_point jsonb; q public.pitacco_delivery_route_quotes%rowtype;
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
   saved_address:=jsonb_build_object(
    'id',case when coalesce(address_item->>'id','') ~ '^[0-9a-f-]{36}$' then address_item->>'id' else gen_random_uuid()::text end,
    'label',case when label='' then 'Casa' else label end,
    'street',v_street,'number',v_number,'neighborhood',v_neighborhood,
    'city',v_city,'state',v_state,'postal',v_postal,'extra',v_extra,
    'is_default',coalesce((address_item->>'is_default')::boolean,false)
   );
   -- Only persist a successful recent quote for this store and exact address.
   saved_text:=concat_ws(', ',v_street,v_number,v_neighborhood,v_city,v_state,
    case when v_postal<>'' then 'CEP '||v_postal end,nullif(v_extra,''));
   saved_point:=null;
   if coalesce(address_item->>'quote_id','') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}
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
; then
    select * into q from public.pitacco_delivery_route_quotes r
     where r.id=(address_item->>'quote_id')::uuid and r.store_id=sid
      and r.destination_address=saved_text and r.expires_at>now()
      and r.destination_latitude between -34 and 6 and r.destination_longitude between -75 and -32
      and (r.address_point_selected or exists(select 1 from public.pitacco_delivery_pricing p
        where p.store_id=sid and p.coverage_type in ('circle','polygon','polygons') and p.updated_at=r.pricing_updated_at));
    if found then saved_point:=jsonb_build_object('latitude',q.destination_latitude,'longitude',q.destination_longitude);end if;
   end if;
   if saved_point is null then
    -- Preserve the previously validated point on unchanged addresses only.
    select a into prior_address from jsonb_array_elements(coalesce(customer.addresses,'[]'::jsonb)) a
     where a->>'id'=saved_address->>'id'
      and (a - 'id' - 'label' - 'is_default' - 'location')=(saved_address - 'id' - 'label' - 'is_default')
     limit 1;
    if found and jsonb_typeof(prior_address->'location')='object' then saved_point:=prior_address->'location';end if;
   end if;
   if saved_point is not null then saved_address:=saved_address||jsonb_build_object('location',saved_point);end if;
   clean_addresses:=clean_addresses||jsonb_build_array(saved_address);
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
notify pgrst,'reload schema';
