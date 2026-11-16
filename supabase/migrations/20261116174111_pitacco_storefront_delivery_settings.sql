create function pitacco_private.reserve_storefront_slug(p_store uuid, p_name text)
returns void language plpgsql set search_path = '' as $$
declare
  base text := left(regexp_replace(lower(translate(p_name,
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]', '', 'g'),60);
  candidate text := base;
begin
  if exists (select 1 from public.public_menu_settings where store_id=p_store) then return; end if;
  if length(base)<3 or base = any(array['www','app','entregador','pitacco','admin','api','mail','cadastro',
    'privacidade','termos','sistema','configuracao','produtos','complementos','cardapio','pedidos','aceite',
    'acompanhar','identidade','assets']) then
    candidate := 'loja-'||replace(p_store::text,'-','');
  end if;
  insert into public.public_menu_settings (store_id,slug) values (p_store,candidate)
  on conflict do nothing;
  if not found then
    candidate := left(base,27)||'-'||replace(p_store::text,'-','');
    insert into public.public_menu_settings (store_id,slug) values (p_store,candidate)
    on conflict (store_id) do nothing;
  end if;
end $$;
revoke all on function pitacco_private.reserve_storefront_slug(uuid,text) from public,anon,authenticated;

create function pitacco_private.provision_storefront()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pitacco_private.reserve_storefront_slug(new.id,new.name);
  return new;
end $$;
revoke all on function pitacco_private.provision_storefront() from public,anon,authenticated;
create trigger pitacco_provision_storefront after insert on public.stores
for each row execute function pitacco_private.provision_storefront();

do $$
declare store record;
begin
  for store in select id,name from public.stores order by id loop
    perform pitacco_private.reserve_storefront_slug(store.id,store.name);
  end loop;
end $$;

create table public.pitacco_store_delivery_areas (
  store_id uuid primary key references public.stores(id) on delete cascade,
  latitude double precision not null check (latitude between -85 and 85),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 100 and 100000),
  enabled boolean not null default false
);
alter table public.pitacco_store_delivery_areas enable row level security;
revoke all on public.pitacco_store_delivery_areas from public,anon,authenticated;
grant select,insert,update on public.pitacco_store_delivery_areas to authenticated;
create policy pitacco_store_manager_delivery_area on public.pitacco_store_delivery_areas
for all to authenticated using (public.is_store_manager(store_id))
with check (public.is_store_manager(store_id));

create function pitacco_private.enforce_storefront_delivery_area(p_store uuid, p_fulfillment text, p_point jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  area public.pitacco_store_delivery_areas%rowtype;
  lat double precision;
  lng double precision;
  arc double precision;
begin
  if p_fulfillment <> 'delivery' then return; end if;
  select * into area from public.pitacco_store_delivery_areas where store_id=p_store and enabled for share;
  if not found then return; end if;
  if p_point is null then raise exception 'Marque o endereço de entrega no mapa'; end if;
  lat := (p_point->>'latitude')::double precision;
  lng := (p_point->>'longitude')::double precision;
  arc := sin(radians(lat-area.latitude)/2)^2
    + cos(radians(area.latitude))*cos(radians(lat))*sin(radians(lng-area.longitude)/2)^2;
  if 12742000 * asin(sqrt(least(1,arc))) > area.radius_m then
    raise exception 'Este endereço está fora da área de entrega da loja';
  end if;
end $$;
revoke all on function pitacco_private.enforce_storefront_delivery_area(uuid,text,jsonb) from public,anon,authenticated;

-- Hook the existing variants after idempotency lookup and before creating a new order.
-- Including the pin in the idempotency payload prevents the same key being reused with a different pin.
do $$
declare
  current_function regprocedure;
  definition text;
  lock_menu constant text := ' select * into cfg from public.public_menu_settings where slug=p_slug for update;';
  receipt_key constant text := $code$'address',address,'items',snapshot,$code$;
  location_key constant text := $code$'address',address,'delivery_location',v_point,'items',snapshot,$code$;
  product_loop constant text := ' for item in select value from jsonb_array_elements(normalized) loop';
  lookup_point constant text := $code$
 if v_point is not null then canonical:=canonical||jsonb_build_object('delivery_location',v_point); end if;
$code$;
  area_guard constant text := $code$
 perform pitacco_private.enforce_storefront_delivery_area(cfg.store_id,p_fulfillment,v_point);
$code$;
begin
  foreach current_function in array array[
    'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
    'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
    'public.pitacco_checkout_scheduled_order(text,uuid,text,text,text,jsonb,text,text,text,timestamptz)'::regprocedure,
    'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
  ] loop
    definition := pg_get_functiondef(current_function);
    if strpos(definition,lock_menu)=0 or strpos(definition,product_loop)=0 or strpos(definition,'declare cfg')=0 or strpos(definition,receipt_key)=0 then
      raise exception 'Checkout % difere da versão de referência', current_function;
    end if;
    definition := replace(definition,'declare cfg', $code$declare v_point jsonb := nullif(current_setting('pitacco.checkout_delivery_point',true),'')::jsonb; cfg$code$);
    definition := replace(definition,lock_menu,lookup_point||lock_menu);
    definition := replace(definition,product_loop,area_guard||product_loop);
    execute replace(definition,receipt_key,location_key);
  end loop;
end $$;

create function public.pitacco_checkout_geocoded_order(
  p_slug text, p_request uuid, p_customer text, p_phone text, p_address text, p_items jsonb,
  p_fulfillment text, p_payment text, p_notes text, p_latitude double precision, p_longitude double precision,
  p_scheduled_for timestamptz default null
)
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  if p_fulfillment is distinct from 'delivery' or not coalesce(
    p_latitude between -85 and 85 and p_longitude between -180 and 180,false
  ) then
    raise exception 'Localização de entrega inválida';
  end if;
  perform set_config('pitacco.checkout_delivery_point',
    jsonb_build_object('latitude',round(p_latitude::numeric,6),'longitude',round(p_longitude::numeric,6))::text,true);
  if p_scheduled_for is null then
    result := public.checkout_public_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes);
  else
    result := public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,p_scheduled_for);
  end if;
  perform set_config('pitacco.checkout_delivery_point','',true);
  return result;
end $$;
revoke all on function public.pitacco_checkout_geocoded_order(text,uuid,text,text,text,jsonb,text,text,text,double precision,double precision,timestamptz)
from public,anon,authenticated;
grant execute on function public.pitacco_checkout_geocoded_order(text,uuid,text,text,text,jsonb,text,text,text,double precision,double precision,timestamptz)
to anon,authenticated;

do $$
declare
  definition text := pg_get_functiondef('public.get_public_menu(text)'::regprocedure);
  position_key constant text := $code$'slug',cfg.slug,$code$;
  area_key constant text := $code$'delivery_area',(select jsonb_build_object('latitude',a.latitude,'longitude',a.longitude,'radius_m',a.radius_m)
    from public.pitacco_store_delivery_areas a where a.store_id=cfg.store_id and a.enabled and cfg.delivery_enabled),$code$;
begin
  if strpos(definition,position_key)=0 then raise exception 'O cardápio difere da versão de referência';end if;
  execute replace(definition,position_key,position_key||area_key);
end $$;

create function public.pitacco_storefront_link(p_store uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug',slug,'enabled',enabled)
  from public.public_menu_settings where store_id=p_store and auth.uid() is not null
    and public.can_access_store(p_store)
$$;
revoke all on function public.pitacco_storefront_link(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_storefront_link(uuid) to authenticated;
