-- Multi-region polygon delivery pricing. Preserve the existing circle-by-km workflow.
alter table public.pitacco_delivery_pricing
 add column if not exists polygons jsonb not null default '[]'::jsonb;

alter table public.pitacco_delivery_pricing
 drop constraint if exists pitacco_delivery_pricing_coverage_type_check;
alter table public.pitacco_delivery_pricing
 add constraint pitacco_delivery_pricing_coverage_type_check
 check (coverage_type in ('circle','polygon','polygons','road'));

alter table public.pitacco_delivery_pricing
 add constraint pitacco_delivery_pricing_polygons_shape
 check (jsonb_typeof(polygons)='array' and jsonb_array_length(polygons)<=12);

-- Preserve existing single-polygon zones as the first ordered region,
-- including each store's current vertices and fee.
update public.pitacco_delivery_pricing
set polygons=jsonb_build_array(jsonb_build_object(
  'id',gen_random_uuid()::text,
  'name','Região 1',
  'vertices',polygon,
  'fee',polygon_fee)),
 coverage_type='polygons',
 updated_at=now()
where coverage_type='polygon'
 and jsonb_typeof(polygon)='array'
 and jsonb_array_length(polygon) between 3 and 30
 and polygons='[]'::jsonb;

create or replace function public.pitacco_save_delivery_polygons(
 p_store uuid, p_polygons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
 store_rec public.stores%rowtype;
 item jsonb;
 vertex jsonb;
 normalized jsonb := '[]'::jsonb;
 v_id text;
 v_name text;
 v_fee numeric;
 v_lat double precision;
 v_lng double precision;
 v_arc double precision;
 v_seen_ids text[] := array[]::text[];
 v_index int := 0;
 v_vertices jsonb;
begin
 if (select auth.uid()) is null
     or not coalesce(public.is_store_manager(p_store), false) then
  raise exception 'Sem permissão para configurar as regiões de entrega'
    using errcode='42501';
 end if;
 if p_polygons is null or jsonb_typeof(p_polygons)<>'array' then
  raise exception 'Informe uma lista de regiões poligonais';
 end if;
 if jsonb_array_length(p_polygons) not between 1 and 12 then
  raise exception 'Cadastre de 1 a 12 regiões poligonais';
 end if;
 select * into store_rec
 from public.stores where id=p_store for update;
 if not found then
  raise exception 'Loja não encontrada';
 end if;
 if store_rec.latitude is null or store_rec.longitude is null
  or nullif(btrim(coalesce(store_rec.address,'')),'') is null
  or nullif(btrim(coalesce(store_rec.city,'')),'') is null
  or nullif(btrim(coalesce(store_rec.state,'')),'') is null then
  raise exception 'Confirme o endereço e o ponto da loja em Dados e identidade';
 end if;
 if not (store_rec.latitude between -34 and 6
   and store_rec.longitude between -75 and -32) then
  raise exception 'O ponto da loja está fora da região permitida';
 end if;
 for item in select value from jsonb_array_elements(p_polygons) loop
  if jsonb_typeof(item)<>'object' then
   raise exception 'Formato de região inválido';
  end if;
  v_index:=v_index+1;
  v_id:=coalesce(nullif(btrim(item->>'id'),''),gen_random_uuid()::text);
  if length(v_id)>100 or v_id=any(v_seen_ids) then
   raise exception 'Regiões repetidas ou identificadores inválidos';
  end if;
  v_seen_ids:=array_append(v_seen_ids,v_id);
  v_name:=btrim(coalesce(item->>'name',''));
  if jsonb_typeof(item->'name')<>'string' or length(v_name) not between 1 and 60 then
   raise exception 'Informe um nome de até 60 caracteres para cada região';
  end if;
  if jsonb_typeof(item->'fee')<>'number' then
   raise exception 'Cada região precisa de um valor de frete';
  end if;
  v_fee:=(item->>'fee')::numeric;
  if v_fee<0 or v_fee>999.99 then
   raise exception 'A taxa da região deve ficar entre R$ 0,00 e R$ 999,99';
  end if;
  v_vertices:=item->'vertices';
  if jsonb_typeof(v_vertices)<>'array' then
   raise exception 'Cada região precisa de um polígono';
  end if;
  if jsonb_array_length(v_vertices) not between 3 and 30 then
   raise exception 'Desenhe de 3 a 30 pontos para cada região';
  end if;
  for vertex in select value from jsonb_array_elements(v_vertices) loop
   if jsonb_typeof(vertex)<>'array' then
    raise exception 'Coordenada inválida na região';
   end if;
   if jsonb_array_length(vertex)<>2
      or jsonb_typeof(vertex->0)<>'number'
      or jsonb_typeof(vertex->1)<>'number' then
    raise exception 'Ponto inválido no polígono';
   end if;
   v_lat:=(vertex->>0)::double precision;
   v_lng:=(vertex->>1)::double precision;
   if not (v_lat between -34 and 6 and v_lng between -75 and -32) then
    raise exception 'Ponto da região fora do Brasil';
   end if;
   v_arc:=sin(radians(v_lat-store_rec.latitude)/2)^2+
      cos(radians(store_rec.latitude))*cos(radians(v_lat))*
      sin(radians(v_lng-store_rec.longitude)/2)^2;
   if 12742000*asin(sqrt(least(1,v_arc)))>30000 then
    raise exception 'O ponto da região está a mais de 30 km da loja';
   end if;
  end loop;
  normalized:=normalized||jsonb_build_array(jsonb_build_object(
   'id',v_id,'name',v_name,'vertices',v_vertices,'fee',round(v_fee,2)
  ));
 end loop;
 insert into public.pitacco_delivery_pricing
  (store_id,polygons,coverage_type,enabled)
 values(p_store,normalized,'polygons',true)
 on conflict(store_id) do update set
  polygons=excluded.polygons,
  coverage_type='polygons',
  enabled=true,
  updated_at=now();
 insert into public.operation_audit(store_id,actor,action,details)
 values(p_store,(select auth.uid()),'delivery_polygons_saved',
  jsonb_build_object('regions',v_index,'overlap_rule','first_listed'));
 return jsonb_build_object('saved',true,'enabled',true,
  'mode','polygons','count',v_index,'polygons',normalized);
end
$fn$;

revoke all on function public.pitacco_save_delivery_polygons(uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.pitacco_save_delivery_polygons(uuid,jsonb)
 to authenticated;
