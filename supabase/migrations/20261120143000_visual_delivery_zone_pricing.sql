-- Delivery prices are controlled exclusively by the merchant's delivery-area
-- configuration. The old public_menu_settings.delivery_fee is not authoritative.
alter table public.pitacco_delivery_pricing
 add column if not exists coverage_type text not null default 'road',
 add column if not exists polygon jsonb not null default '[]'::jsonb,
 add column if not exists polygon_fee numeric(10,2) not null default 0;

alter table public.pitacco_delivery_pricing
 drop constraint if exists pitacco_delivery_pricing_coverage_type_check;
alter table public.pitacco_delivery_pricing
 add constraint pitacco_delivery_pricing_coverage_type_check
 check (coverage_type in ('circle','polygon','road'));
alter table public.pitacco_delivery_pricing
 drop constraint if exists pitacco_delivery_pricing_polygon_fee_check;
alter table public.pitacco_delivery_pricing
 add constraint pitacco_delivery_pricing_polygon_fee_check check(polygon_fee between 0 and 999.99);

alter table public.pitacco_delivery_route_quotes
 add column if not exists destination_latitude double precision,
 add column if not exists destination_longitude double precision;

create or replace function public.pitacco_save_delivery_zone(
 p_store uuid,p_mode text,p_radius integer,p_distance jsonb,
 p_polygon jsonb,p_polygon_fee numeric
) returns jsonb
language plpgsql security definer set search_path to ''
as $func$
declare
 item jsonb;
 vertex jsonb;
 store_rec public.stores%rowtype;
 v_lat double precision;
 v_lng double precision;
 i integer := 0;
 arc double precision;
begin
 if (select auth.uid()) is null or not public.is_store_manager(p_store) then
  raise exception 'Sem permissão para configurar entregas' using errcode='42501';
 end if;
 if p_mode not in ('circle','polygon') or p_radius not between 1 and 10
  or jsonb_typeof(p_distance) <> 'array' or jsonb_array_length(p_distance) <> 10
  or p_polygon_fee is null or p_polygon_fee not between 0 and 999.99
  or jsonb_typeof(p_polygon) <> 'array' or jsonb_array_length(p_polygon) > 30 then
  raise exception 'Área ou preços de entrega inválidos';
 end if;
 select * into store_rec from public.stores where id=p_store;
 if not found then raise exception 'Loja não encontrada'; end if;
 if store_rec.latitude is null or store_rec.longitude is null
  or store_rec.address is null or store_rec.city is null or store_rec.state is null then
  raise exception 'Confirme o ponto e o endereço da loja em Dados da loja';
 end if;
 for item in select value from jsonb_array_elements(p_distance) loop
  if jsonb_typeof(item)<>'number' or (item::text)::numeric not between 0 and 999.99 then
   raise exception 'Taxas por distância inválidas';
  end if;
 end loop;
 if p_mode='polygon' then
  if jsonb_array_length(p_polygon) not between 3 and 30 then
   raise exception 'Marque pelo menos três pontos no polígono';
  end if;
  for vertex in select value from jsonb_array_elements(p_polygon) loop
   if jsonb_typeof(vertex)<>'array' or jsonb_array_length(vertex)<>2
    or jsonb_typeof(vertex->0)<>'number' or jsonb_typeof(vertex->1)<>'number' then
    raise exception 'Ponto inválido no polígono';
   end if;
   v_lat:=(vertex->>0)::double precision;
   v_lng:=(vertex->>1)::double precision;
   if not (v_lat between -34 and 6 and v_lng between -75 and -32) then
    raise exception 'Ponto do polígono fora da região permitida';
   end if;
   arc:=sin(radians(v_lat-store_rec.latitude)/2)^2+
     cos(radians(store_rec.latitude))*cos(radians(v_lat))*
     sin(radians(v_lng-store_rec.longitude)/2)^2;
   if 12742000*asin(sqrt(least(1,arc)))>30000 then
    raise exception 'O ponto está a mais de 30 km da loja';
   end if;
   i:=i+1;
  end loop;
 end if;
 insert into public.pitacco_delivery_pricing
  (store_id,max_radius_km,distance_fees,neighborhood_fees,enabled,coverage_type,polygon,polygon_fee)
 values
  (p_store,p_radius,p_distance,'[]'::jsonb,true,p_mode,p_polygon,round(p_polygon_fee,2))
 on conflict(store_id) do update set
  max_radius_km=excluded.max_radius_km,
  distance_fees=excluded.distance_fees,
  enabled=true,coverage_type=excluded.coverage_type,
  polygon=excluded.polygon,polygon_fee=excluded.polygon_fee,
  updated_at=now();
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,(select auth.uid()),'delivery_zone_saved',
  jsonb_build_object('mode',p_mode,'radius_km',p_radius));
 return jsonb_build_object('saved',true,'enabled',true,'mode',p_mode);
end $func$;
revoke all on function public.pitacco_save_delivery_zone(uuid,text,integer,jsonb,jsonb,numeric) from public,anon;
grant execute on function public.pitacco_save_delivery_zone(uuid,text,integer,jsonb,jsonb,numeric) to authenticated;

-- Checkout must never fall back to the legacy fee from Pagamentos.
create or replace function pitacco_private.checkout_delivery_fee(
 p_store uuid,p_fulfillment text,p_address text,p_request uuid,p_fallback numeric
) returns numeric language plpgsql security definer set search_path to ''
as $func$
declare
 rules public.pitacco_delivery_pricing%rowtype;
 q public.pitacco_delivery_route_quotes%rowtype;
 quote_id uuid;
begin
 if p_fulfillment<>'delivery' then return 0; end if;
 select * into rules from public.pitacco_delivery_pricing where store_id=p_store;
 if not found or not rules.enabled then
  raise exception 'A loja precisa configurar a área e as taxas de entrega';
 end if;
 quote_id:=nullif(current_setting('pitacco.checkout_delivery_quote',true),'')::uuid;
 if quote_id is null then
  raise exception 'Calcule o frete da área de entrega antes de confirmar o pedido';
 end if;
 select * into q from public.pitacco_delivery_route_quotes
  where id=quote_id and store_id=p_store and request_id=p_request
  and destination_address=trim(p_address) and expires_at>now() for share;
 if not found or q.pricing_updated_at<>rules.updated_at then
  raise exception 'Cotação de entrega inválida ou expirada. Calcule novamente o frete';
 end if;
 if rules.coverage_type='circle' and q.distance_m>rules.max_radius_km*1000 then
  raise exception 'Endereço fora da área de entrega'; end if;
 if q.fee is null or q.fee < 0 or q.fee > 999.99 then
  raise exception 'Preço de entrega inválido';end if;
 return q.fee;
end $func$;
