-- Store-scoped verified address cache. Never stores names, phone numbers or complements.
create table pitacco_private.verified_delivery_addresses(
 store_id uuid not null references public.stores(id) on delete cascade,
 street_key text not null,house_key text not null,district_key text not null,city_key text not null,state_key text not null,postal_key text not null,
 latitude double precision not null check(latitude between -34 and 6),
 longitude double precision not null check(longitude between -75 and -32),
 verified_at timestamptz not null default now(),
 verification_source text not null default 'merchant' check(verification_source in ('merchant','completed_delivery')),
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
 insert into pitacco_private.verified_delivery_addresses(store_id,street_key,house_key,district_key,city_key,state_key,postal_key,latitude,longitude,verified_at)
 values(p_store,k[1],k[2],k[3],k[4],k[5],k[6],q.destination_latitude,q.destination_longitude,q.created_at)
 on conflict(store_id,street_key,house_key,district_key,city_key,state_key,postal_key)
 do update set latitude=excluded.latitude,longitude=excluded.longitude,verified_at=excluded.verified_at,verification_source='merchant'
 where pitacco_private.verified_delivery_addresses.verification_source='completed_delivery' or pitacco_private.verified_delivery_addresses.verified_at<=excluded.verified_at;
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
 -- Prefer the numerically closest known building as a map reference only.
 -- Numbering may be irregular: this is never a verified point for another house.
 order by case when k[2]~'^[0-9]{1,9}$' and house_key~'^[0-9]{1,9}$'
  then abs(house_key::bigint-k[2]::bigint) else null end nulls last,
  verified_at desc,house_key limit 1;
 if found then return jsonb_build_object('exact',false,'latitude',a.latitude,'longitude',a.longitude);end if;
 return null;
end $lookup$;
revoke all on function public.pitacco_service_verified_delivery_address(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.pitacco_service_verified_delivery_address(uuid,text) to service_role;
-- Record only deliberate location selections that belong to a real order.
alter table public.pitacco_delivery_route_quotes add column address_point_selected boolean not null default false;
create table pitacco_private.delivery_address_observations(
 order_id uuid primary key references public.orders(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 address_key text[] not null check(cardinality(address_key)=6),
 latitude double precision not null check(latitude between -34 and 6),
 longitude double precision not null check(longitude between -75 and -32),
 observed_at timestamptz not null default now()
);
alter table pitacco_private.delivery_address_observations enable row level security;
revoke all on pitacco_private.delivery_address_observations from public,anon,authenticated,service_role;

create function pitacco_private.learn_delivery_address_from_order()
returns trigger language plpgsql security definer set search_path='' as $learn$
declare q public.pitacco_delivery_route_quotes%rowtype;k text[];o pitacco_private.delivery_address_observations%rowtype;
begin
 if new.status='cancelled' then
  delete from pitacco_private.delivery_address_observations where order_id=new.id;
  return new;
 end if;
 if new.source is distinct from 'proprio' or new.request_id is null then return new;end if;
 if tg_op='INSERT' then
  select * into q from public.pitacco_delivery_route_quotes
   where store_id=new.store_id and request_id=new.request_id and address_point_selected
    and destination_address=new.receipt->>'address' and expires_at>=new.created_at
    and destination_latitude between -34 and 6 and destination_longitude between -75 and -32
   order by created_at desc limit 1;
  if found then
   k:=pitacco_private.delivery_address_key(q.destination_address);
   if k is not null then
    insert into pitacco_private.delivery_address_observations(order_id,store_id,address_key,latitude,longitude,observed_at)
    values(new.id,new.store_id,k,q.destination_latitude,q.destination_longitude,q.created_at)
    on conflict(order_id) do nothing;
   end if;
  end if;
 end if;
 if new.status='accepted' and new.preparation_status='completed' then
  select * into o from pitacco_private.delivery_address_observations where order_id=new.id and store_id=new.store_id;
  if found then
   k:=o.address_key;
   insert into pitacco_private.verified_delivery_addresses(store_id,street_key,house_key,district_key,city_key,state_key,postal_key,latitude,longitude,verified_at,verification_source)
   values(o.store_id,k[1],k[2],k[3],k[4],k[5],k[6],o.latitude,o.longitude,o.observed_at,'completed_delivery')
   on conflict(store_id,street_key,house_key,district_key,city_key,state_key,postal_key)
   do update set latitude=excluded.latitude,longitude=excluded.longitude,verified_at=excluded.verified_at
   where pitacco_private.verified_delivery_addresses.verification_source='completed_delivery'
    and pitacco_private.verified_delivery_addresses.verified_at<excluded.verified_at;
   delete from pitacco_private.delivery_address_observations where order_id=new.id;
  end if;
 end if;
 return new;
end $learn$;
revoke all on function pitacco_private.learn_delivery_address_from_order() from public,anon,authenticated,service_role;
create trigger learn_verified_delivery_address after insert or update of preparation_status,status on public.orders
 for each row execute function pitacco_private.learn_delivery_address_from_order();
notify pgrst,'reload schema';
