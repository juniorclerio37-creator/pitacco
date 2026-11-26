-- Store-scoped verified address cache. Never stores names, phone numbers or complements.
create table pitacco_private.verified_delivery_addresses(
 store_id uuid not null references public.stores(id) on delete cascade,
 street_key text not null,house_key text not null,district_key text not null,city_key text not null,state_key text not null,postal_key text not null,
 latitude double precision not null check(latitude between -34 and 6),
 longitude double precision not null check(longitude between -75 and -32),
 verified_at timestamptz not null default now(),
 primary key(store_id,street_key,house_key,district_key,city_key,state_key,postal_key)
);
alter table pitacco_private.verified_delivery_addresses enable row level security;
revoke all on pitacco_private.verified_delivery_addresses from public,anon,authenticated,service_role;

create function pitacco_private.delivery_address_key(p_address text)
returns text[] language plpgsql immutable set search_path='' as $key$
declare a text[]; p text; i integer;
begin
 if p_address is null or length(p_address)>500 then return null;end if;
 a:=string_to_array(p_address,',');
 if cardinality(a)<5 then return null;end if;
 for i in 1..5 loop
  a[i]:=trim(regexp_replace(translate(lower(a[i]),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g'));
  if a[i]='' or length(a[i])>160 then return null;end if;
 end loop;
 a[1]:=regexp_replace(a[1],'^(rua|r|avenida|av|travessa|tv) +','');
 if length(a[1])<2 or a[5]!~'^[a-z]{2}$' or a[2] in ('s n','sn','sem numero') then return null;end if;
 p:=coalesce((regexp_match(p_address,'\mCEP\s*([0-9]{5}-?[0-9]{3})\M','i'))[1],'');
 return array[a[1],a[2],a[3],a[4],a[5],regexp_replace(p,'[^0-9]','','g')];
end $key$;
revoke all on function pitacco_private.delivery_address_key(text) from public,anon,authenticated,service_role;

create function public.pitacco_save_verified_delivery_address(p_store uuid,p_quote uuid)
returns jsonb language plpgsql security definer set search_path='' as $save$
declare q public.pitacco_delivery_route_quotes%rowtype;k text[];
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501';end if;
 select * into q from public.pitacco_delivery_route_quotes where id=p_quote and store_id=p_store and expires_at>now();
 if not found or q.destination_latitude is null or q.destination_longitude is null then raise exception 'Recalcule o frete antes de salvar a localização';end if;
 k:=pitacco_private.delivery_address_key(q.destination_address);
 if k is null then raise exception 'Informe rua, número, bairro, cidade e UF antes de salvar';end if;
 insert into pitacco_private.verified_delivery_addresses(store_id,street_key,house_key,district_key,city_key,state_key,postal_key,latitude,longitude)
 values(p_store,k[1],k[2],k[3],k[4],k[5],k[6],q.destination_latitude,q.destination_longitude)
 on conflict(store_id,street_key,house_key,district_key,city_key,state_key,postal_key)
 do update set latitude=excluded.latitude,longitude=excluded.longitude,verified_at=now();
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'delivery_address_verified',jsonb_build_object('quote_id',p_quote));
 return jsonb_build_object('saved',true);
end $save$;
revoke all on function public.pitacco_save_verified_delivery_address(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pitacco_save_verified_delivery_address(uuid,uuid) to authenticated;

-- Service only: exact matches may be used for quotes; street references require confirmation.
create function public.pitacco_service_verified_delivery_address(p_store uuid,p_address text)
returns jsonb language plpgsql stable security definer set search_path='' as $lookup$
declare k text[];a pitacco_private.verified_delivery_addresses%rowtype;
begin
 k:=pitacco_private.delivery_address_key(p_address);
 if k is null then return null;end if;
 select * into a from pitacco_private.verified_delivery_addresses
 where store_id=p_store and street_key=k[1] and house_key=k[2] and district_key=k[3] and city_key=k[4] and state_key=k[5] and postal_key=k[6] and verified_at>now()-interval '365 days';
 if found then return jsonb_build_object('exact',true,'latitude',a.latitude,'longitude',a.longitude);end if;
 select * into a from pitacco_private.verified_delivery_addresses
 where store_id=p_store and street_key=k[1] and district_key=k[3] and city_key=k[4] and state_key=k[5] and (k[6]='' or postal_key=k[6]) and verified_at>now()-interval '365 days'
 order by verified_at desc,house_key limit 1;
 if found then return jsonb_build_object('exact',false,'latitude',a.latitude,'longitude',a.longitude);end if;
 return null;
end $lookup$;
revoke all on function public.pitacco_service_verified_delivery_address(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.pitacco_service_verified_delivery_address(uuid,text) to service_role;
notify pgrst,'reload schema';
