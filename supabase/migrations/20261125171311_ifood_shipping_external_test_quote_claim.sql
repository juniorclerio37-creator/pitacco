create table if not exists pitacco_private.ifood_shipping_external_tests(
 quote_id uuid primary key,store_id uuid not null references public.stores(id),merchant_id uuid not null references pitacco_private.ifood_merchants(merchant_id),
 latitude double precision not null check(latitude between -90 and 90),longitude double precision not null check(longitude between -180 and 180),
 amount numeric(12,2) not null check(amount>=0),expires_at timestamptz not null,
 state text not null default 'quoted' check(state in('quoted','requesting','submitted','failed','uncertain')),
 attempt uuid,external_id uuid unique,tracking_url text,provider_http integer,updated_at timestamptz not null default now()
);
alter table pitacco_private.ifood_shipping_external_tests enable row level security;
revoke all on pitacco_private.ifood_shipping_external_tests from public,anon,authenticated;
create or replace function public.pitacco_ifood_shipping_external_test(p_store uuid,p_actor uuid,p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; mid uuid; b pitacco_private.ifood_shipping_external_tests%rowtype; q uuid; exp timestamptz; v numeric; h integer; ext uuid; tr text;
begin
 ctx:=public.pitacco_ifood_shipping_test_context(p_store,p_actor,null);
 mid:=(ctx->>'merchant_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('shipping-external-test:'||mid::text,0));
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from (
  select x.quote_id,x.state,x.external_id,x.tracking_url,x.provider_http,x.updated_at,x.amount,x.expires_at
  from pitacco_private.ifood_shipping_external_tests x where x.store_id=p_store and x.merchant_id=mid order by x.updated_at desc limit 30) t),'[]'::jsonb);
 end if;
 q:=(p_data->>'id')::uuid;
 if q is null then raise exception 'invalid quote';end if;
 if p_action='quote' then
  exp:=(p_data->>'expirationAt')::timestamptz;v:=(p_data->>'netValue')::numeric;
  if exp is null or exp<=now() or exp>now()+interval '48 hours' or v is null or v<0 or v>10000 then raise exception 'invalid quote';end if;
  insert into pitacco_private.ifood_shipping_external_tests(quote_id,store_id,merchant_id,latitude,longitude,amount,expires_at)
  values(q,p_store,mid,(p_data->>'latitude')::double precision,(p_data->>'longitude')::double precision,v,exp)
  on conflict(quote_id) do nothing;
 end if;
 select * into b from pitacco_private.ifood_shipping_external_tests where quote_id=q and store_id=p_store and merchant_id=mid for update;
 if not found then raise exception 'quote unavailable';end if;
 if p_action='quote' or p_action='get' then
  return jsonb_build_object('id',b.quote_id,'merchantId',mid,'latitude',b.latitude,'longitude',b.longitude,'expirationAt',b.expires_at,'netValue',b.amount,'state',b.state);
 elsif p_action='claim' then
  if b.state<>'quoted' or b.expires_at<=now() or b.amount is distinct from (p_data->>'netValue')::numeric or b.latitude is distinct from (p_data->>'latitude')::double precision or b.longitude is distinct from (p_data->>'longitude')::double precision then raise exception 'quote changed or already used';end if;
  if exists(select 1 from pitacco_private.ifood_shipping_external_tests x where x.merchant_id=mid and x.state in('requesting','uncertain')) then raise exception 'unresolved earlier request';end if;
  update pitacco_private.ifood_shipping_external_tests set state='requesting',attempt=gen_random_uuid(),updated_at=now() where quote_id=q returning * into b;
  return jsonb_build_object('attempt',b.attempt,'state',b.state);
 elsif p_action='finish' then
  if b.state<>'requesting' or b.attempt is distinct from (p_data->>'attempt')::uuid then raise exception 'attempt mismatch';end if;
  h:=(p_data->>'http')::integer;ext:=(p_data->>'external_id')::uuid;tr:=p_data->>'tracking_url';
  if tr is not null and (length(tr)>500 or tr !~ '^https://meupedido[.]ifood[.]com[.]br/[a-fA-F0-9-]{36}$') then raise exception 'invalid tracking URL';end if;
  update pitacco_private.ifood_shipping_external_tests set state=case when h=202 and ext is not null then 'submitted' when h in(400,401,403,404,422) then 'failed' else 'uncertain' end,
  provider_http=h,external_id=case when h=202 then ext end,tracking_url=case when h=202 then tr end,updated_at=now() where quote_id=q returning * into b;
  return jsonb_build_object('state',b.state,'external_id',b.external_id,'tracking_url',b.tracking_url,'provider_http',b.provider_http);
 end if;
 raise exception 'invalid action';
end $$;
revoke all on function public.pitacco_ifood_shipping_external_test(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_shipping_external_test(uuid,uuid,text,jsonb) to service_role;;
