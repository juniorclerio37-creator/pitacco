-- Cotações calculadas exclusivamente no backend por provedor de rotas homologado.
create table public.pitacco_delivery_route_quotes (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 request_id uuid not null,
 destination_address text not null check(length(destination_address) between 5 and 500),
 distance_m integer not null check(distance_m>=0),
 fee numeric(10,2) not null check(fee between 0 and 999.99),
 pricing_updated_at timestamptz not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(store_id,request_id)
);
alter table public.pitacco_delivery_route_quotes enable row level security;
revoke all on public.pitacco_delivery_route_quotes from public,anon,authenticated;
grant select,insert,update on public.pitacco_delivery_route_quotes to service_role;
-- Sem policies: somente service_role e funções internas podem tocar dados de clientes.

create or replace function pitacco_private.checkout_delivery_fee(
 p_store uuid,p_fulfillment text,p_address text,p_request uuid,p_fallback numeric
) returns numeric language plpgsql volatile security definer set search_path='' as $$
declare rules public.pitacco_delivery_pricing%rowtype;
 q public.pitacco_delivery_route_quotes%rowtype; quote_id uuid;
begin
 if p_fulfillment<>'delivery' then return 0; end if;
 select * into rules from public.pitacco_delivery_pricing where store_id=p_store;
 if not found or not rules.enabled then return p_fallback; end if;
 quote_id:=nullif(current_setting('pitacco.checkout_delivery_quote',true),'')::uuid;
 if quote_id is null then raise exception 'Calcule o frete do endereço antes de confirmar o pedido';end if;
 select * into q from public.pitacco_delivery_route_quotes
  where id=quote_id and store_id=p_store and request_id=p_request
  and destination_address=trim(p_address) and expires_at>now() for share;
 if not found or q.pricing_updated_at<>rules.updated_at then
  raise exception 'Cotação de entrega inválida ou expirada. Calcule novamente o frete';
 end if;
 if q.distance_m>rules.max_radius_km*1000 then raise exception 'Endereço fora da área de entrega';end if;
 return q.fee;
end $$;
revoke all on function pitacco_private.checkout_delivery_fee(uuid,text,text,uuid,numeric) from public,anon,authenticated;

-- Checkout legado é preservado para lojas sem regras de rota ativas.
-- Para lojas com nova cobrança, todos os caminhos precisam de cotação assinada no backend.
do $$
declare f regprocedure; def text; needle constant text :=
  'fee:=case when p_fulfillment=''delivery'' then cfg.delivery_fee else 0 end;';
begin
 foreach f in array array[
  'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
  'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
  'public.pitacco_checkout_scheduled_order(text,uuid,text,text,text,jsonb,text,text,text,timestamptz)'::regprocedure,
  'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
  def:=pg_get_functiondef(f);
  if strpos(def,needle)=0 then raise exception 'Checkout % não corresponde à versão esperada',f; end if;
  execute replace(def,needle,
   'fee:=pitacco_private.checkout_delivery_fee(cfg.store_id,p_fulfillment,address,p_request,cfg.delivery_fee);');
 end loop;
end $$;

-- A verificação por pin do fluxo antigo não deve sobrepor a cotação viária.
do $$
declare def text := pg_get_functiondef(
 'pitacco_private.enforce_storefront_delivery_area(uuid,text,jsonb)'::regprocedure);
  old text := 'if p_fulfillment <> ''delivery'' then return; end if;';
begin
 if strpos(def,old)=0 then raise exception 'Guarda de área legada inesperada';end if;
 execute replace(def,old,
  'if p_fulfillment <> ''delivery'' or exists(select 1 from public.pitacco_delivery_pricing where store_id=p_store and enabled) then return; end if;');
end $$;

-- O cardápio público recebe apenas a indicação do modo de cálculo (sem regras internas).
do $$
declare def text:=pg_get_functiondef('public.get_public_menu(text)'::regprocedure);
needle constant text:='''delivery_area'',';
begin
 if strpos(def,needle)=0 then raise exception 'Estrutura do cardápio público inesperada';end if;
 execute replace(def,needle,
 '''route_pricing'',(select jsonb_build_object(''enabled'',r.enabled,''max_radius_km'',r.max_radius_km)
   from public.pitacco_delivery_pricing r where r.store_id=cfg.store_id and r.enabled),
  '||needle);
end $$;

-- RPC novo: a cotação vem do serviço de rotas; nunca de valor calculado no navegador.
create function public.pitacco_checkout_quoted_delivery(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,p_items jsonb,
 p_fulfillment text,p_payment text,p_notes text,p_quote uuid,p_scheduled_for timestamptz default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_quote is null or p_fulfillment<>'delivery' then raise exception 'Cotação de entrega obrigatória'; end if;
 perform set_config('pitacco.checkout_delivery_quote',p_quote::text,true);
 if p_scheduled_for is null then
  result:=public.checkout_public_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes);
 else
  result:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,p_scheduled_for);
 end if;
 perform set_config('pitacco.checkout_delivery_quote','',true);
 return result;
end $$;
revoke all on function public.pitacco_checkout_quoted_delivery(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.pitacco_checkout_quoted_delivery(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) to anon,authenticated;
