create table pitacco_private.pagbank_sandbox_checkout(
 id uuid primary key, store_id uuid not null references public.stores(id), provider_account_id text not null,
 payload jsonb not null, snapshot jsonb not null, subtotal_cents integer not null, fee_cents integer not null, discount_cents integer not null,
 total_cents integer not null check(total_cents between 1 and 10000), created_at timestamptz not null default now(),
 check(total_cents=subtotal_cents+fee_cents-discount_cents)
);
alter table pitacco_private.pagbank_sandbox_checkout enable row level security;
revoke all on pitacco_private.pagbank_sandbox_checkout from public,anon,authenticated;
create function public.pitacco_pagbank_sandbox_checkout(p_store uuid,p_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.public_menu_settings%rowtype; a pitacco_private.pagbank_sandbox_accounts%rowtype; prior pitacco_private.pagbank_sandbox_checkout%rowtype;
 item jsonb; product public.products%rowtype; opt jsonb; items jsonb; snapshot jsonb:='[]'; quantity integer;
 fulfillment text; address text; quote_id uuid; point jsonb; coupon_code text; coupon public.loyalty_coupons%rowtype; sub integer; fee integer:=0; discount integer:=0; total integer; phone text;
begin
 if p_store is null or p_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>16000 then raise exception 'Dados inválidos'; end if;
 if p_payload-array['items','fulfillment','address','quote','coupon','phone']<>'{}'::jsonb then raise exception 'Campos de checkout inválidos'; end if;
 if not exists(select 1 from pitacco_private.ifood_merchants where store_id=p_store and test_only) then raise exception 'Somente loja de homologação'; end if;
 select * into cfg from public.public_menu_settings where store_id=p_store and enabled for share;
 if not found then raise exception 'Cardápio indisponível';end if;
 select * into a from pitacco_private.pagbank_sandbox_accounts where store_id=p_store;
 if not found or (a.expires_at is not null and a.expires_at<=now()) then raise exception 'Conta PagBank de teste indisponível'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,42));
 select * into prior from pitacco_private.pagbank_sandbox_checkout where id=p_id;
 if found then
  if prior.store_id<>p_store or prior.provider_account_id<>a.provider_account_id or prior.payload<>p_payload then raise exception 'Chave reutilizada com dados diferentes';end if;
  return to_jsonb(prior)-'provider_account_id'-'payload';
 end if;
 if exists(select 1 from pitacco_private.pagbank_sandbox_pix where id=p_id) then raise exception 'Chave indisponível';end if;
 if (select count(*) from pitacco_private.pagbank_sandbox_checkout where store_id=p_store and created_at>now()-interval '1 minute')>=10 then raise exception 'Limite temporário de testes';end if;
 items:=p_payload->'items'; fulfillment:=p_payload->>'fulfillment'; address:=trim(coalesce(p_payload->>'address','')); coupon_code:=upper(trim(coalesce(p_payload->>'coupon','')));
 phone:=regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');
 if fulfillment is null or fulfillment not in ('pickup','delivery') or (fulfillment='pickup' and not cfg.pickup_enabled) or (fulfillment='delivery' and not cfg.delivery_enabled) then raise exception 'Modalidade indisponível';end if;
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 30 then raise exception 'Carrinho inválido';end if;
 if length(coupon_code)>32 or length(address)>500 or (phone<>'' and length(phone) not between 10 and 13) then raise exception 'Dados inválidos'; end if;
 if phone<>'' and exists(select 1 from public.pitacco_customer_blocks b where b.store_id=p_store and b.match_type='phone' and b.match_value=phone and b.active and (b.expires_at is null or b.expires_at>now())) then raise exception 'Cliente bloqueado';end if;
 perform pitacco_private.require_store_open(p_store);
 sub:=pitacco_private.loyalty_subtotal(p_store,items);
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['product_id','quantity','options']<>'{}'::jsonb then raise exception 'Item inválido';end if;
  select * into strict product from public.products where id=(item->>'product_id')::uuid and store_id=p_store and menu_active for share;
  quantity:=(item->>'quantity')::integer;
  opt:=public.pitacco_validate_item_options(p_store,product.id,coalesce(item->'options','[]'::jsonb));
  snapshot:=snapshot||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'quantity',quantity,'unit_price',product.price,'modifiers',opt->'modifiers','unit_total',product.price+(opt->>'extra')::numeric));
 end loop;
 if fulfillment='delivery' then
  quote_id:=nullif(p_payload->>'quote','')::uuid;
  if quote_id is null or length(address)<5 then raise exception 'Cotação de entrega obrigatória';end if;
  point:=public.pitacco_delivery_quote_point(quote_id,p_id,address);
  if point is null then raise exception 'Cotação inválida';end if;
  perform set_config('pitacco.checkout_delivery_quote',quote_id::text,true);
  perform pitacco_private.enforce_storefront_delivery_area(p_store,fulfillment,point);
  fee:=round(pitacco_private.checkout_delivery_fee(p_store,fulfillment,address,p_id,cfg.delivery_fee)*100)::integer;
  perform set_config('pitacco.checkout_delivery_quote','',true);
 end if;
 if coupon_code<>'' then
  select * into coupon from public.loyalty_coupons where store_id=p_store and code=coupon_code and active and (starts_at is null or starts_at<=now()) and (expires_at is null or expires_at>now()) and (max_uses is null or uses<max_uses) and kind is distinct from 'reward' and target_customer_id is null for share;
  if not found or sub<coupon.minimum_order_cents then raise exception 'Cupom indisponível';end if;
  discount:=case when coupon.discount_type='percent' then round(sub*coupon.discount_value/100)::integer else least(sub,round(coupon.discount_value*100)::integer) end;
  if discount<=0 or discount>sub then raise exception 'Desconto inválido';end if;
 end if;
 total:=sub+fee-discount;
 if total not between 1 and 10000 then raise exception 'Valor fora do limite Sandbox (R$ 100,00)';end if;
 insert into pitacco_private.pagbank_sandbox_checkout(id,store_id,provider_account_id,payload,snapshot,subtotal_cents,fee_cents,discount_cents,total_cents)
 values(p_id,p_store,a.provider_account_id,p_payload,snapshot,sub,fee,discount,total) returning * into prior;
 return to_jsonb(prior)-'provider_account_id'-'payload';
end $$;
revoke all on function public.pitacco_pagbank_sandbox_checkout(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pitacco_pagbank_sandbox_checkout(uuid,uuid,jsonb) to service_role;
create function pitacco_private.pagbank_checkout_amount_guard() returns trigger language plpgsql set search_path='' as $$
declare i pitacco_private.pagbank_sandbox_checkout%rowtype;
begin
 select * into i from pitacco_private.pagbank_sandbox_checkout where id=new.id;
 if found and (new.store_id is distinct from i.store_id or new.cents<>i.total_cents) then raise exception 'Valor ou loja diverge do checkout calculado pelo servidor';end if;
 return new;
end $$;
revoke all on function pitacco_private.pagbank_checkout_amount_guard() from public,anon,authenticated;
create trigger pagbank_checkout_amount_guard before insert or update on pitacco_private.pagbank_sandbox_pix for each row execute function pitacco_private.pagbank_checkout_amount_guard();