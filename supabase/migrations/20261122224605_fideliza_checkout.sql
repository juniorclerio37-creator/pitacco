create function pitacco_private.loyalty_coupon_record(s uuid,oid uuid,cpid uuid,p_phone text) returns void
language plpgsql security definer set search_path='' as $$
declare cp public.loyalty_coupons%rowtype;rules jsonb;c uuid;
begin
 select * into cp from public.loyalty_coupons where id=cpid and store_id=s for update;
 if not found or not pitacco_private.loyalty_available(s) then raise exception 'Cupom indisponível';end if;
 rules:=pitacco_private.loyalty_rules(s);
 c:=nullif(current_setting('pitacco.loyalty_customer',true),'')::uuid;
 if c is not null and not exists(select 1 from pitacco_private.loyalty_customers lc where lc.id=c and lc.store_id=s and lc.phone=p_phone and lc.active) then
  raise exception 'Acesse o Fideliza+ com o mesmo telefone do pedido';end if;
 if (cp.kind='coupon' and not (rules->>'coupons_enabled')::boolean)
  or (cp.kind='campaign' and not (rules->>'campaigns_enabled')::boolean) then raise exception 'Esta modalidade foi desativada pela loja';end if;
 if cp.target_customer_id is not null and cp.target_customer_id is distinct from c then raise exception 'Cupom exclusivo para outro cliente';end if;
 if cp.kind='reward' and (c is null or cp.reward_request_id is distinct from nullif(current_setting('pitacco.loyalty_request',true),'')::uuid) then
  raise exception 'Resgate deve ser feito pela carteira do Fideliza+';end if;
 if cp.per_customer_limit is not null then
  if c is null then raise exception 'Entre no Fideliza+ para usar este cupom pessoal';end if;
  if (select count(*) from public.loyalty_coupon_redemptions r where r.store_id=s and r.coupon_id=cp.id and r.customer_id=c and r.state<>'cancelled')>=cp.per_customer_limit then
   raise exception 'Limite deste cupom por cliente atingido';end if;
 end if;
 insert into public.loyalty_coupon_redemptions(store_id,coupon_id,order_id,customer_id)
 values(s,cpid,oid,c) on conflict do nothing;
end $$;
revoke all on function pitacco_private.loyalty_coupon_record(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Todos os caminhos antigos continuam válidos, mas não podem contornar limites pessoais.
do $migration$
declare f regprocedure;def text;needle text:='if v_coupon_code<>'''' then update public.loyalty_coupons set uses=uses+1 where id=v_coupon.id; end if;';
begin
 foreach f in array array[
  'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
  'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
  def:=pg_get_functiondef(f);
  if strpos(def,needle)=0 then raise exception 'Checkout % difere da versão verificada',f;end if;
  execute replace(def,needle,'if v_coupon_code<>'''' then perform pitacco_private.loyalty_coupon_record(cfg.store_id,oid,v_coupon.id,v_phone); update public.loyalty_coupons set uses=uses+1 where id=v_coupon.id; end if;');
 end loop;
end $migration$;

create function pitacco_private.loyalty_subtotal(s uuid,items jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare item jsonb;p public.products%rowtype;opt jsonb;total numeric:=0;q integer;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 30 then raise exception 'Carrinho inválido';end if;
 for item in select value from jsonb_array_elements(items) loop
  if item->>'quantity' !~ '^[0-9]{1,2}$' then raise exception 'Quantidade inválida';end if;
  q:=(item->>'quantity')::integer;
  if q not between 1 and 20 then raise exception 'Quantidade inválida';end if;
  select * into p from public.products where id=(item->>'product_id')::uuid and store_id=s and menu_active for share;
  if not found then raise exception 'Produto indisponível';end if;
  opt:=public.pitacco_validate_item_options(s,p.id,coalesce(item->'options','[]'::jsonb));
  total:=total+(p.price+(opt->>'extra')::numeric)*q;
 end loop;
 if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 return round(total*100)::integer;
end $$;
create function pitacco_private.loyalty_reward(s uuid,c uuid,kind text,subtotal integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rules jsonb:=pitacco_private.loyalty_rules(s);cost integer;discount integer;asset text;
begin
 if not pitacco_private.loyalty_available(s) or c is null then raise exception 'Acesse sua carteira do Fideliza+';end if;
 if kind='points' and (rules->>'points_enabled')::boolean then
  asset:='points';cost:=(rules->>'min_points_to_redeem')::integer;discount:=(rules->>'points_reward_cents')::integer;
 elsif kind='orders' and (rules->>'orders_enabled')::boolean then
  asset:='orders';cost:=(rules->>'orders_required')::integer;discount:=(rules->>'orders_reward_cents')::integer;
 elsif kind='cashback' and ((rules->>'cashback_enabled')::boolean or (rules->>'referrals_enabled')::boolean) then
  asset:='cashback';cost:=least(pitacco_private.loyalty_balance(s,c,asset),floor(subtotal*(rules->>'cashback_max_redeem_percent')::numeric/100),subtotal-1)::integer;
  discount:=cost;
 else raise exception 'Benefício desativado ou inválido';end if;
 if cost<=0 or pitacco_private.loyalty_balance(s,c,asset)<cost then raise exception 'Saldo insuficiente para este benefício';end if;
 if discount>=subtotal then raise exception 'O valor dos produtos deve superar o benefício em pelo menos R$ 0,01';end if;
 return jsonb_build_object('asset',asset,'cost',cost,'discount_cents',discount);
end $$;
revoke all on function pitacco_private.loyalty_subtotal(uuid,jsonb),pitacco_private.loyalty_reward(uuid,uuid,text,integer) from public,anon,authenticated;

create function public.pitacco_loyalty_preview(p_slug text,p_items jsonb,p_key text default '',p_coupon text default '',p_reward text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s uuid;c uuid;subtotal integer;discount integer:=0;cp public.loyalty_coupons%rowtype;reward jsonb;rules jsonb;
begin
 select store_id into s from public.public_menu_settings where slug=p_slug and enabled for share;
 if s is null or not pitacco_private.loyalty_available(s) then raise exception 'Fideliza+ indisponível';end if;
 c:=pitacco_private.loyalty_customer(s,p_key);subtotal:=pitacco_private.loyalty_subtotal(s,p_items);rules:=pitacco_private.loyalty_rules(s);
 if coalesce(p_reward,'')<>'' and coalesce(trim(p_coupon),'')<>'' then raise exception 'Escolha um cupom ou um resgate por pedido';end if;
 if coalesce(p_reward,'')<>'' then
  reward:=pitacco_private.loyalty_reward(s,c,p_reward,subtotal);discount:=(reward->>'discount_cents')::integer;
 elsif trim(coalesce(p_coupon,''))<>'' then
  select * into cp from public.loyalty_coupons where store_id=s and code=upper(trim(p_coupon)) and active
   and kind<>'reward' and (starts_at is null or starts_at<=now()) and (expires_at is null or expires_at>now()) and (max_uses is null or uses<max_uses);
  if not found then raise exception 'Cupom indisponível ou expirado';end if;
  if (cp.kind='coupon' and not (rules->>'coupons_enabled')::boolean) or (cp.kind='campaign' and not (rules->>'campaigns_enabled')::boolean) then raise exception 'Modalidade desativada';end if;
  if cp.target_customer_id is not null and cp.target_customer_id is distinct from c then raise exception 'Cupom exclusivo para outro cliente';end if;
  if cp.per_customer_limit is not null and (c is null or (select count(*) from public.loyalty_coupon_redemptions where store_id=s and coupon_id=cp.id and customer_id=c and state<>'cancelled')>=cp.per_customer_limit) then raise exception 'Acesso pessoal necessário ou limite do cupom atingido';end if;
  if subtotal<cp.minimum_order_cents then raise exception 'Pedido abaixo do mínimo do cupom';end if;
  discount:=case when cp.discount_type='percent' then round(subtotal*cp.discount_value/100)::integer else least(subtotal,round(cp.discount_value*100)::integer) end;
 end if;
 return jsonb_build_object('subtotal_cents',subtotal,'discount_cents',discount,'products_total_cents',subtotal-discount);
end $$;

create function public.pitacco_loyalty_checkout(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,p_items jsonb,p_fulfillment text,p_payment text,p_notes text default '',
 p_key text default '',p_coupon text default '',p_reward text default '',p_quote uuid default null,p_scheduled_for timestamptz default null,p_fiado_code text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s uuid;c uuid;v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 prior pitacco_private.loyalty_order_links%rowtype;canonical jsonb;normalized jsonb;result jsonb;reward jsonb;coupon text:=upper(trim(coalesce(p_coupon,'')));
 subtotal integer;oid uuid;rules jsonb;point jsonb;
begin
 select store_id into s from public.public_menu_settings where slug=p_slug for update;
 if s is null or p_request is null then raise exception 'Cardápio ou requisição inválida';end if;
 if coalesce(p_key,'')<>'' then
  c:=pitacco_private.loyalty_customer(s,p_key);
  if c is null then raise exception 'Chave pessoal inválida';end if;
  perform 1 from pitacco_private.loyalty_customers where id=c and store_id=s and phone=v_phone for update;
  if not found then raise exception 'Use o telefone da sua carteira no pedido';end if;
 end if;
 if coalesce(p_reward,'')<>'' and coupon<>'' then raise exception 'Escolha um cupom ou um resgate por pedido';end if;
 if p_payment='fiado' and (coalesce(p_reward,'')<>'' or coupon<>'') then raise exception 'Para usar desconto, escolha pagamento no pedido. Fiado acumula benefícios após quitação e entrega.';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Carrinho inválido';end if;
 select jsonb_agg(jsonb_build_object('product_id',x->>'product_id','quantity',x->'quantity',
  'options',coalesce((select jsonb_agg(v order by v) from jsonb_array_elements(coalesce(x->'options','[]'::jsonb)) v),'[]'::jsonb)) order by x->>'product_id',x->'options') into normalized from jsonb_array_elements(p_items) x;
 canonical:=jsonb_build_object('customer',p_customer,'phone',v_phone,'address',p_address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',p_notes,
  'customer_id',c,'coupon',coupon,'reward',p_reward,'quote',p_quote,'scheduled_for',p_scheduled_for,
  'fiado_hash',case when p_fiado_code is not null then encode(sha256(convert_to(p_fiado_code,'UTF8')),'hex') end);
 select * into prior from pitacco_private.loyalty_order_links where store_id=s and request_id=p_request;
 if found then
  if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
  return prior.response;
 end if;
 if not pitacco_private.loyalty_available(s) then raise exception 'Fideliza+ indisponível';end if;
 if exists(select 1 from public.orders where store_id=s and request_id=p_request) then
  raise exception 'Este pedido já foi criado fora do Fideliza+; consulte seu acompanhamento';
 end if;
 rules:=pitacco_private.loyalty_rules(s);
 perform set_config('pitacco.loyalty_customer',coalesce(c::text,''),true);
 perform set_config('pitacco.loyalty_request',p_request::text,true);
 if coalesce(p_reward,'')<>'' then
  subtotal:=pitacco_private.loyalty_subtotal(s,p_items);
  reward:=pitacco_private.loyalty_reward(s,c,p_reward,subtotal);
  coupon:='RW_'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,24));
  insert into public.loyalty_coupons(store_id,code,discount_type,discount_value,minimum_order_cents,max_uses,kind,target_customer_id,reward_request_id)
  values(s,coupon,'fixed',(reward->>'discount_cents')::numeric/100,(reward->>'discount_cents')::integer+1,1,'reward',c,p_request);
 end if;
 if p_quote is not null then
  if p_fulfillment<>'delivery' then raise exception 'Cotação permitida somente na entrega';end if;
  point:=public.pitacco_delivery_quote_point(p_quote,p_request,p_address);
  if point is null then raise exception 'Recalcule a localização do frete';end if;
  perform set_config('pitacco.checkout_delivery_quote',p_quote::text,true);
  perform set_config('pitacco.checkout_delivery_point',point::text,true);
 end if;
 if p_payment='fiado' then
  result:=public.pitacco_checkout_fiado(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_notes,p_fiado_code,p_quote,p_scheduled_for);
 elsif coupon<>'' then
  if p_scheduled_for is null then
   result:=public.checkout_public_order_coupon(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,coupon);
  else
   result:=public.pitacco_checkout_scheduled_order_coupon(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,coupon,p_scheduled_for);
  end if;
 else
  if p_scheduled_for is null then
   result:=public.checkout_public_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes);
  else
   result:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,p_phone,p_address,p_items,p_fulfillment,p_payment,p_notes,p_scheduled_for);
  end if;
 end if;
 perform set_config('pitacco.loyalty_customer','',true);perform set_config('pitacco.loyalty_request','',true);
 perform set_config('pitacco.checkout_delivery_quote','',true);
 perform set_config('pitacco.checkout_delivery_point','',true);
 if result ? 'error' then return result;end if;
 oid:=(result->>'order_id')::uuid;
 if oid is null then raise exception 'Pedido não confirmado';end if;
 insert into pitacco_private.loyalty_order_links(order_id,store_id,customer_id,request_id,payload,response,rules)
 values(oid,s,c,p_request,canonical,result,rules);
 if reward is not null then
  perform pitacco_private.loyalty_entry(s,c,oid,reward->>'asset',-(reward->>'cost')::integer,'redeem','loyalty:redeem:'||oid::text);
  insert into public.operation_audit(store_id,order_id,action,details)
   values(s,oid,'loyalty_reward_reserved',jsonb_build_object('customer',c,'asset',reward->>'asset','cost',reward->'cost','discount_cents',reward->'discount_cents'));
 end if;
 perform pitacco_private.loyalty_refresh_order(oid);
 return result;
end $$;
revoke all on function public.pitacco_loyalty_preview(text,jsonb,text,text,text),
 public.pitacco_loyalty_checkout(text,uuid,text,text,text,jsonb,text,text,text,text,text,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.pitacco_loyalty_preview(text,jsonb,text,text,text),
 public.pitacco_loyalty_checkout(text,uuid,text,text,text,jsonb,text,text,text,text,text,text,uuid,timestamptz,text) to anon,authenticated;
