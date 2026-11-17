-- Configuração de entrega por endereço. Regras inativas por padrão até homologação do provedor de rotas.
create table if not exists public.pitacco_delivery_pricing (
  store_id uuid primary key references public.stores(id) on delete cascade,
  max_radius_km integer not null default 5 check (max_radius_km between 1 and 10),
  distance_fees jsonb not null default '[0,0,0,0,0,0,0,0,0,0]'::jsonb,
  neighborhood_fees jsonb not null default '[]'::jsonb,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint pricing_fee_shape check (
    jsonb_typeof(distance_fees)='array' and jsonb_array_length(distance_fees)=10
    and jsonb_typeof(neighborhood_fees)='array' and jsonb_array_length(neighborhood_fees)<=100
  )
);
alter table public.pitacco_delivery_pricing enable row level security;
revoke all on public.pitacco_delivery_pricing from public,anon,authenticated;
grant select on public.pitacco_delivery_pricing to authenticated;
create policy pitacco_delivery_pricing_store_read on public.pitacco_delivery_pricing
  for select to authenticated using (public.is_store_manager(store_id));

create or replace function public.pitacco_save_delivery_pricing(
 p_store uuid,p_radius integer,p_distance jsonb,p_neighborhoods jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; n int:=0; row_store public.stores%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestores podem configurar entregas' using errcode='42501';
 end if;
 if p_radius not between 1 and 10
    or jsonb_typeof(p_distance)<>'array' or jsonb_array_length(p_distance)<>10
    or jsonb_typeof(p_neighborhoods)<>'array' or jsonb_array_length(p_neighborhoods)>100 then
  raise exception 'Faixas e bairros inválidos';
 end if;
 select * into row_store from public.stores where id=p_store;
 if not found then raise exception 'Loja não encontrada'; end if;
 if nullif(trim(coalesce(row_store.address,'')),'') is null
   or nullif(trim(coalesce(row_store.city,'')),'') is null
   or nullif(trim(coalesce(row_store.state,'')),'') is null then
  raise exception 'Cadastre rua, cidade e estado em Dados da loja antes de configurar entregas';
 end if;
 for item in select value from jsonb_array_elements(p_distance) loop
  if jsonb_typeof(item)<>'number' or (item::text)::numeric < 0 or (item::text)::numeric > 999.99 then
   raise exception 'Taxa por quilômetro inválida';
  end if;
 end loop;
 for item in select value from jsonb_array_elements(p_neighborhoods) loop
  n:=n+1;
  if jsonb_typeof(item)<>'object'
     or item ?& array['bairro','cidade','taxa'] is false
     or jsonb_typeof(item->'bairro')<>'string'
     or jsonb_typeof(item->'cidade')<>'string'
     or jsonb_typeof(item->'taxa')<>'number'
     or length(trim(item->>'bairro')) not between 2 and 80
     or length(trim(item->>'cidade')) not between 2 and 80
     or (item->>'taxa')::numeric < 0 or (item->>'taxa')::numeric > 999.99 then
    raise exception 'Bairro ou taxa inválidos (linha %)',n;
  end if;
 end loop;
 insert into public.pitacco_delivery_pricing(store_id,max_radius_km,distance_fees,neighborhood_fees,enabled)
 values(p_store,p_radius,p_distance,p_neighborhoods,false)
 on conflict(store_id) do update set
  max_radius_km=excluded.max_radius_km,distance_fees=excluded.distance_fees,
  neighborhood_fees=excluded.neighborhood_fees,enabled=false,updated_at=now();
 return jsonb_build_object('saved',true,'enabled',false,'requires_route_provider',true);
end $$;
revoke all on function public.pitacco_save_delivery_pricing(uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_save_delivery_pricing(uuid,integer,jsonb,jsonb) to authenticated;

-- Cálculo único das faixas e precedência de bairros; acesso reservado ao backend.
create or replace function pitacco_private.delivery_rate_for_route(
 p_store uuid,p_distance_m integer,p_city text,p_neighborhood text
) returns numeric language plpgsql stable set search_path='' as $$
declare cfg public.pitacco_delivery_pricing%rowtype; entry jsonb; km integer;
begin
 select * into cfg from public.pitacco_delivery_pricing where store_id=p_store;
 if not found or not cfg.enabled then raise exception 'Tabela de entregas não está ativa'; end if;
 if p_distance_m is null or p_distance_m<0 or p_distance_m>cfg.max_radius_km*1000 then
  raise exception 'Endereço fora da área de entrega';
 end if;
 for entry in select value from jsonb_array_elements(cfg.neighborhood_fees) loop
  if lower(trim(entry->>'bairro'))=lower(trim(coalesce(p_neighborhood,'')))
   and lower(trim(entry->>'cidade'))=lower(trim(coalesce(p_city,'')))
   then return (entry->>'taxa')::numeric; end if;
 end loop;
 km:=greatest(1,ceil(p_distance_m/1000.0)::integer);
 return (cfg.distance_fees->>(km-1))::numeric;
end $$;
revoke all on function pitacco_private.delivery_rate_for_route(uuid,integer,text,text) from public,anon,authenticated;
