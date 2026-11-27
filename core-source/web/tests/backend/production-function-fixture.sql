CREATE OR REPLACE FUNCTION public.checkout_public_order(p_slug text, p_request uuid, p_customer text, p_phone text, p_address text, p_items jsonb, p_fulfillment text, p_payment text, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg public.public_menu_settings%rowtype; prior public.public_checkouts%rowtype; item jsonb; product public.products%rowtype; canonical jsonb; normalized jsonb; snapshot jsonb:='[]'; v_phone text; customer text; address text; notes text; quantity integer; option_result jsonb; subtotal numeric:=0; fee numeric; total numeric; oid uuid; token uuid; st text;
begin
 if p_request is null or p_customer is null or length(trim(p_customer)) not between 2 and 120 or p_phone is null or length(p_phone)>30 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') or p_payment is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos';end if;
 if jsonb_array_length(p_items) not between 1 and 30 or octet_length(p_items::text)>12000 then raise exception 'Carrinho invalido';end if;
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');if length(v_phone) not between 10 and 13 then raise exception 'Telefone invalido';end if;
 customer:=public.dg_clean_text(trim(p_customer));address:=public.dg_clean_text(trim(coalesce(p_address,'')));notes:=public.dg_clean_text(trim(coalesce(p_notes,'')));
 if p_fulfillment='delivery' and length(address)<5 then raise exception 'Informe o endereco';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'object' or not item ?& array['product_id','quantity'] or (item-array['product_id','quantity','options'])<>'{}'::jsonb or jsonb_typeof(item->'product_id')<>'string' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity')!~ '^[0-9]+$' then raise exception 'Item invalido';end if;
 quantity:=(item->>'quantity')::integer;if quantity not between 1 and 20 then raise exception 'Quantidade invalida';end if;if item ? 'options' and jsonb_typeof(item->'options')<>'array' then raise exception 'Complementos inválidos';end if;perform(item->>'product_id')::uuid;end loop;
 if(select count(distinct(value->>'product_id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Produto repetido';end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer,'options',coalesce(value->'options','[]'::jsonb)) order by(value->>'product_id')::uuid) into normalized from jsonb_array_elements(p_items);
 canonical:=jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',notes);
 select * into cfg from public.public_menu_settings where slug=p_slug for update;if not found then raise exception 'Cardapio indisponivel';end if;
 select * into prior from public.public_checkouts where store_id=cfg.store_id and request_id=p_request;
 if found then
 if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
 return(select jsonb_build_object('order_id',o.id,'tracking_token',prior.tracking_token,'total',o.gross,'status',o.status,'payment_status',case when exists(select 1 from public.manual_payments where order_id=o.id) then 'paid_manual' else 'pending' end,'payment_instructions',prior.payment_instructions) from public.orders o where o.id=prior.order_id);end if;
 if not cfg.enabled or (p_fulfillment='delivery' and not cfg.delivery_enabled) or (p_fulfillment='pickup' and not cfg.pickup_enabled) or not p_payment=any(cfg.payment_methods) then raise exception 'Modalidade indisponivel';end if;
 if exists(select 1 from public.orders where store_id=cfg.store_id and request_id=p_request) then raise exception 'Chave indisponivel';end if;
 if(select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.created_at>now()-interval '1 minute')>=100 or (select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.phone=v_phone and c.created_at>now()-interval '15 minutes')>=5 then raise exception 'Limite temporario de pedidos';end if;
 for item in select value from jsonb_array_elements(normalized) loop
 select * into product from public.products where id=(item->>'product_id')::uuid and store_id=cfg.store_id and menu_active for share;if not found then raise exception 'Produto indisponivel';end if;
 quantity:=(item->>'quantity')::integer;option_result:=public.pitacco_validate_item_options(cfg.store_id,product.id,item->'options');subtotal:=subtotal+(product.price+(option_result->>'extra')::numeric)*quantity;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('name',public.dg_clean_text(product.name),'quantity',quantity,'unit_price',product.price,'modifiers',option_result->'modifiers','unit_total',product.price+(option_result->>'extra')::numeric));end loop;
 fee:=case when p_fulfillment='delivery' then cfg.delivery_fee else 0 end;total:=subtotal+fee;if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'total',total,'discount',0,'notes',notes,'payment',p_payment,'payment_status','pending','logistics',case when p_fulfillment='delivery' then 'loja' else 'retirada' end)) returning id into oid;
 insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,payment_instructions) values(oid,cfg.store_id,p_request,canonical,v_phone,case when p_payment='pix_manual' then cfg.pix_instructions else '' end) returning tracking_token into token;
 insert into public.operation_audit(store_id,order_id,actor,action) values(cfg.store_id,oid,auth.uid(),'public_checkout_created');
 if exists(select 1 from public.acceptance_settings where store_id=cfg.store_id and source='proprio' and mode='automatic' and enabled) then perform public.dg_accept_own(oid);end if;
 select status into st from public.orders where id=oid;
 return jsonb_build_object('order_id',oid,'tracking_token',token,'total',total,'status',st,'payment_status','pending','payment_instructions',case when p_payment='pix_manual' then cfg.pix_instructions else '' end);
end $function$;
CREATE OR REPLACE FUNCTION public.pitacco_register_store(p_name text, p_document text)
 RETURNS TABLE(store_id uuid, trial_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid(); v_name text:=btrim(p_name); v_doc text:=regexp_replace(coalesce(p_document,''),'[^0-9]','','g'); v_kind text; v_hash text; v_store uuid; v_end timestamptz; v_pepper text; v_existing uuid;
begin
 if v_uid is null then raise exception 'Autenticação necessária'; end if;
 if v_name is null or length(v_name)<3 or length(v_name)>100 then raise exception 'Nome da loja inválido'; end if;
 if not pitacco_private.valid_document(v_doc) then raise exception 'CPF ou CNPJ inválido'; end if;
 v_kind:=case when length(v_doc)=14 then 'cnpj' else 'cpf' end;
 select pepper into v_pepper from pitacco_private.identity_secret where id=true;
 v_hash:=encode(extensions.hmac(v_doc,v_pepper,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_kind||v_hash,0));
 select t.first_store_id,t.ends_at into v_store,v_end from public.pitacco_signup_trials t where t.user_id=v_uid;
 if found then return query select v_store,v_end; return; end if;
 select r.first_store_id into v_existing from pitacco_private.trial_identity_registry r where r.identity_kind=v_kind and r.identity_hash=v_hash;
 if found then raise exception 'Este CPF/CNPJ já utilizou o período de teste. Entre em contato com o suporte para cadastrar outro estabelecimento.'; end if;
 insert into public.profiles(id,email,full_name,role)
 select u.id,u.email,coalesce(u.raw_user_meta_data->>'full_name',''),'lojista'
 from auth.users u where u.id=v_uid on conflict(id) do nothing;
 insert into public.stores(name,platform,plan) values(v_name,'delivery proprio','saas') returning id into v_store;
 insert into public.store_members(store_id,user_id,role) values(v_store,v_uid,'lojista');
 insert into public.subscriptions(store_id,monthly_amount,status,due_date) values(v_store,59.90,'pendente',current_date+30);
 insert into public.pitacco_signup_trials(user_id,first_store_id,started_at,ends_at) values(v_uid,v_store,now(),now()+interval '30 days') returning ends_at into v_end;
 insert into pitacco_private.trial_identity_registry(identity_kind,identity_hash,first_user_id,first_store_id,first_trial_started_at)
 values(v_kind,v_hash,v_uid,v_store,now());
 return query select v_store,v_end;
end $function$;
CREATE OR REPLACE FUNCTION public.checkout_public_order_coupon(p_slug text, p_request uuid, p_customer text, p_phone text, p_address text, p_items jsonb, p_fulfillment text, p_payment text, p_notes text, p_coupon text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg public.public_menu_settings%rowtype; prior public.public_checkouts%rowtype; item jsonb; product public.products%rowtype; canonical jsonb; normalized jsonb; snapshot jsonb:='[]'; v_phone text; customer text; address text; notes text; quantity integer; option_result jsonb; subtotal numeric:=0; fee numeric; total numeric; v_discount numeric:=0; v_coupon public.loyalty_coupons%rowtype; v_coupon_code text; oid uuid; token uuid; st text;
begin
 if p_request is null or p_customer is null or length(trim(p_customer)) not between 2 and 120 or p_phone is null or length(p_phone)>30 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') or p_payment is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos';end if;
 if jsonb_array_length(p_items) not between 1 and 30 or octet_length(p_items::text)>12000 then raise exception 'Carrinho invalido';end if;
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');if length(v_phone) not between 10 and 13 then raise exception 'Telefone invalido';end if;
 customer:=public.dg_clean_text(trim(p_customer));address:=public.dg_clean_text(trim(coalesce(p_address,'')));notes:=public.dg_clean_text(trim(coalesce(p_notes,'')));
 if p_fulfillment='delivery' and length(address)<5 then raise exception 'Informe o endereco';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'object' or not item ?& array['product_id','quantity'] or (item-array['product_id','quantity','options'])<>'{}'::jsonb or jsonb_typeof(item->'product_id')<>'string' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity')!~ '^[0-9]+$' then raise exception 'Item invalido';end if;
 quantity:=(item->>'quantity')::integer;if quantity not between 1 and 20 then raise exception 'Quantidade invalida';end if;if item ? 'options' and jsonb_typeof(item->'options')<>'array' then raise exception 'Complementos inválidos';end if;perform(item->>'product_id')::uuid;end loop;
 if(select count(distinct(value->>'product_id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Produto repetido';end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer,'options',coalesce(value->'options','[]'::jsonb)) order by(value->>'product_id')::uuid) into normalized from jsonb_array_elements(p_items);
 v_coupon_code:=upper(trim(coalesce(p_coupon,''))); if length(v_coupon_code)>32 then raise exception 'Cupom inválido';end if; canonical:=jsonb_build_object('coupon',v_coupon_code,'customer',customer,'phone',v_phone,'address',address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',notes);
 select * into cfg from public.public_menu_settings where slug=p_slug for update;if not found then raise exception 'Cardapio indisponivel';end if;
 select * into prior from public.public_checkouts where store_id=cfg.store_id and request_id=p_request;
 if found then
 if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
 return(select jsonb_build_object('order_id',o.id,'tracking_token',prior.tracking_token,'total',o.gross,'discount',coalesce((o.receipt->>'discount')::numeric,0),'subtotal',coalesce((o.receipt->>'subtotal')::numeric,0),'delivery_fee',coalesce((o.receipt->>'delivery_fee')::numeric,0),'status',o.status,'payment_status',case when exists(select 1 from public.manual_payments where order_id=o.id) then 'paid_manual' else 'pending' end,'payment_instructions',prior.payment_instructions) from public.orders o where o.id=prior.order_id);end if;
 if not cfg.enabled or (p_fulfillment='delivery' and not cfg.delivery_enabled) or (p_fulfillment='pickup' and not cfg.pickup_enabled) or not p_payment=any(cfg.payment_methods) then raise exception 'Modalidade indisponivel';end if;
 if exists(select 1 from public.orders where store_id=cfg.store_id and request_id=p_request) then raise exception 'Chave indisponivel';end if;
 if(select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.created_at>now()-interval '1 minute')>=100 or (select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.phone=v_phone and c.created_at>now()-interval '15 minutes')>=5 then raise exception 'Limite temporario de pedidos';end if;
 for item in select value from jsonb_array_elements(normalized) loop
 select * into product from public.products where id=(item->>'product_id')::uuid and store_id=cfg.store_id and menu_active for share;if not found then raise exception 'Produto indisponivel';end if;
 quantity:=(item->>'quantity')::integer;option_result:=public.pitacco_validate_item_options(cfg.store_id,product.id,item->'options');subtotal:=subtotal+(product.price+(option_result->>'extra')::numeric)*quantity;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('name',public.dg_clean_text(product.name),'quantity',quantity,'unit_price',product.price,'modifiers',option_result->'modifiers','unit_total',product.price+(option_result->>'extra')::numeric));end loop;
 fee:=case when p_fulfillment='delivery' then cfg.delivery_fee else 0 end;
if v_coupon_code<>'' then
 select * into v_coupon from public.loyalty_coupons where store_id=cfg.store_id and code=v_coupon_code and active and (expires_at is null or expires_at>now()) and (max_uses is null or uses<max_uses) for update;
 if not found then raise exception 'Cupom indisponível ou expirado'; end if;
 if round(subtotal*100)::integer<v_coupon.minimum_order_cents then raise exception 'Pedido abaixo do mínimo do cupom';end if;
 v_discount:=case when v_coupon.discount_type='percent' then round(subtotal*v_coupon.discount_value/100,2) else least(subtotal,v_coupon.discount_value) end;
 if v_discount<=0 or v_discount>subtotal then raise exception 'Desconto inválido';end if;
end if;
total:=subtotal+fee-v_discount;if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'total',total,'discount',v_discount,'coupon_code',nullif(v_coupon_code,''),'notes',notes,'payment',p_payment,'payment_status','pending','logistics',case when p_fulfillment='delivery' then 'loja' else 'retirada' end)) returning id into oid;
 if v_coupon_code<>'' then update public.loyalty_coupons set uses=uses+1 where id=v_coupon.id; end if; insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,payment_instructions) values(oid,cfg.store_id,p_request,canonical,v_phone,case when p_payment='pix_manual' then cfg.pix_instructions else '' end) returning tracking_token into token;
 insert into public.operation_audit(store_id,order_id,actor,action) values(cfg.store_id,oid,auth.uid(),'public_checkout_created');
 if exists(select 1 from public.acceptance_settings where store_id=cfg.store_id and source='proprio' and mode='automatic' and enabled) then perform public.dg_accept_own(oid);end if;
 select status into st from public.orders where id=oid;
 return jsonb_build_object('order_id',oid,'tracking_token',token,'total',total,'discount',v_discount,'subtotal',subtotal,'delivery_fee',fee,'status',st,'payment_status','pending','payment_instructions',case when p_payment='pix_manual' then cfg.pix_instructions else '' end);
end $function$;
CREATE OR REPLACE FUNCTION public.pitacco_track_public_order(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
 'order_id',o.id,'status',o.status,'preparation_status',o.preparation_status,
 'created_at',o.created_at,'accepted_at',o.accepted_at,
 'fulfillment',case when c.payload->>'fulfillment'='pickup' or o.receipt->>'address'='retirada' or o.receipt->>'logistics'='retirada' then 'pickup' else 'delivery' end,
 'delivery_status',d.status,'total',o.gross,
 'store',jsonb_build_object('name',s.name,'logo_url',b.logo_url,'primary_color',coalesce(b.primary_color,'#db482f')),
 'items',coalesce(o.receipt->'items','[]'::jsonb),
 'payment_method',o.receipt->>'payment'
)
from public.public_checkouts c
join public.orders o on o.id=c.order_id and o.store_id=c.store_id
join public.stores s on s.id=o.store_id
left join public.store_customer_branding b on b.store_id=o.store_id
left join lateral(select status from public.deliveries where order_id=o.id order by created_at desc limit 1)d on true
where c.tracking_token=p_token and c.expires_at>now() limit 1
$function$;
CREATE OR REPLACE FUNCTION public.pitacco_validate_item_options(p_store uuid, p_product uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare grp record;opt record;entry jsonb;chosen uuid[]:=array[]::uuid[];selected_count int;extra numeric:=0;mods jsonb:='[]'::jsonb;canonical jsonb:='[]'::jsonb;begin
if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options)>100 then raise exception 'Complementos inválidos';end if;
for entry in select value from jsonb_array_elements(p_options) loop
if jsonb_typeof(entry)<>'string' or (entry#>>'{}') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Complemento inválido';end if;
if (entry#>>'{}')::uuid=any(chosen) then raise exception 'Complemento repetido';end if;
chosen:=array_append(chosen,(entry#>>'{}')::uuid);
end loop;
for grp in select * from public.product_option_groups where store_id=p_store and product_id=p_product order by sort_order,id loop
select count(*) into selected_count from public.product_options o where o.group_id=grp.id and o.id=any(chosen) and o.available;
if selected_count<grp.min_select or selected_count>grp.max_select then raise exception 'Quantidade de escolhas inválida no grupo %',grp.name;end if;
end loop;
for opt in select o.*,g.name as group_name from public.product_options o join public.product_option_groups g on g.id=o.group_id where o.id=any(chosen) and o.store_id=p_store and g.product_id=p_product and o.available order by g.sort_order,g.id,o.sort_order,o.id loop
extra:=extra+opt.additional_price;
mods:=mods||jsonb_build_array(jsonb_build_object('group',opt.group_name,'name',opt.name,'price',opt.additional_price));
canonical:=canonical||jsonb_build_array(opt.id::text);
end loop;
if jsonb_array_length(canonical)<>cardinality(chosen) then raise exception 'Complemento indisponível ou pertencente a outro produto';end if;
return jsonb_build_object('modifiers',mods,'extra',extra,'canonical',canonical);
end $function$;
