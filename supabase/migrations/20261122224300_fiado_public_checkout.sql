-- Os checkouts existentes preservam preço, variações, frete, agenda, idempotência, horário e antifraude.
CREATE OR REPLACE FUNCTION public.checkout_public_order(p_slug text, p_request uuid, p_customer text, p_phone text, p_address text, p_items jsonb, p_fulfillment text, p_payment text, p_notes text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_point jsonb := nullif(current_setting('pitacco.checkout_delivery_point',true),'')::jsonb; cfg public.public_menu_settings%rowtype; prior public.public_checkouts%rowtype; item jsonb; product public.products%rowtype; canonical jsonb; normalized jsonb; snapshot jsonb:='[]'; v_phone text; customer text; address text; notes text; quantity integer; option_result jsonb; subtotal numeric:=0; fee numeric; total numeric; oid uuid; token uuid; st text;
begin
 if p_request is null or p_customer is null or length(trim(p_customer)) not between 2 and 120 or p_phone is null or length(p_phone)>30 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') or p_payment is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos';end if;
 if jsonb_array_length(p_items) not between 1 and 30 or octet_length(p_items::text)>12000 then raise exception 'Carrinho invalido';end if;
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');if length(v_phone) not between 10 and 13 then raise exception 'Telefone invalido';end if;
 customer:=public.dg_clean_text(trim(p_customer));address:=public.dg_clean_text(trim(coalesce(p_address,'')));notes:=public.dg_clean_text(trim(coalesce(p_notes,'')));
 if p_fulfillment='delivery' and length(address)<5 then raise exception 'Informe o endereco';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'object' or not item ?& array['product_id','quantity'] or (item-array['product_id','quantity','options'])<>'{}'::jsonb or jsonb_typeof(item->'product_id')<>'string' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity')!~ '^[0-9]+$' then raise exception 'Item invalido';end if;
 quantity:=(item->>'quantity')::integer;if quantity not between 1 and 20 then raise exception 'Quantidade invalida';end if;if item ? 'options' and jsonb_typeof(item->'options')<>'array' then raise exception 'Complementos inválidos';end if;perform(item->>'product_id')::uuid;end loop;
 
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(line)
    group by (line->>'product_id')::uuid,
      array(select option_id::uuid
            from jsonb_array_elements_text(coalesce(line->'options','[]'::jsonb)) as option_value(option_id)
            order by option_id::uuid)
    having count(*) > 1
  ) then
    raise exception 'Combine itens com os mesmos complementos em uma única linha';
  end if;

 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer,'options',coalesce(value->'options','[]'::jsonb)) order by (value->>'product_id')::uuid, coalesce(value->'options','[]'::jsonb)) into normalized from jsonb_array_elements(p_items);
 canonical:=jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',notes);

 if v_point is not null then canonical:=canonical||jsonb_build_object('delivery_location',v_point); end if;
 select * into cfg from public.public_menu_settings where slug=p_slug for update;if not found then raise exception 'Cardapio indisponivel';end if;
 select * into prior from public.public_checkouts where store_id=cfg.store_id and request_id=p_request;
 if found then
 if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
 return(select jsonb_build_object('order_id',o.id,'tracking_token',prior.tracking_token,'total',o.gross,'status',o.status,'payment_status',case when exists(select 1 from public.manual_payments where order_id=o.id) then 'paid_manual' else 'pending' end,'payment_instructions',prior.payment_instructions) from public.orders o where o.id=prior.order_id);end if;
 perform pitacco_private.require_store_open(cfg.store_id);
 if not cfg.enabled or (p_fulfillment='delivery' and not cfg.delivery_enabled) or (p_fulfillment='pickup' and not cfg.pickup_enabled) or (p_payment<>'fiado' and not p_payment=any(cfg.payment_methods)) then raise exception 'Modalidade indisponivel';end if;
 if exists(select 1 from public.orders where store_id=cfg.store_id and request_id=p_request) then raise exception 'Chave indisponivel';end if;
 if(select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.created_at>now()-interval '1 minute')>=100 or (select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.phone=v_phone and c.created_at>now()-interval '15 minutes')>=5 then raise exception 'Limite temporario de pedidos';end if;

 perform pitacco_private.enforce_storefront_delivery_area(cfg.store_id,p_fulfillment,v_point);
 for item in select value from jsonb_array_elements(normalized) loop
 select * into product from public.products where id=(item->>'product_id')::uuid and store_id=cfg.store_id and menu_active for share;if not found then raise exception 'Produto indisponivel';end if;
 quantity:=(item->>'quantity')::integer;option_result:=public.pitacco_validate_item_options(cfg.store_id,product.id,item->'options');subtotal:=subtotal+(product.price+(option_result->>'extra')::numeric)*quantity;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',public.dg_clean_text(product.name),'quantity',quantity,'unit_price',product.price,'modifiers',option_result->'modifiers','unit_total',product.price+(option_result->>'extra')::numeric));end loop;
 fee:=pitacco_private.checkout_delivery_fee(cfg.store_id,p_fulfillment,address,p_request,cfg.delivery_fee);total:=subtotal+fee;if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'delivery_location',v_point,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'delivery_fee_original',fee,'total',total,'discount',0,'notes',notes,'payment',p_payment,'payment_status','pending','logistics',case when p_fulfillment='delivery' then 'loja' else 'retirada' end)) returning id into oid;
 insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,payment_instructions) values(oid,cfg.store_id,p_request,canonical,v_phone,case when p_payment='pix_manual' then cfg.pix_instructions else '' end) returning tracking_token into token;
 insert into public.operation_audit(store_id,order_id,actor,action) values(cfg.store_id,oid,auth.uid(),'public_checkout_created');
 if exists(select 1 from public.acceptance_settings where store_id=cfg.store_id and source='proprio' and mode='automatic' and enabled) and not (p_payment='fiado' and exists(select 1 from public.pitacco_fiado_customers fc where fc.id=nullif(current_setting('pitacco.fiado_customer',true),'')::uuid and fc.approval_mode='manual')) then perform public.dg_accept_own(oid);end if;
 select status into st from public.orders where id=oid;
 return jsonb_build_object('order_id',oid,'tracking_token',token,'total',total,'status',st,'payment_status','pending','payment_instructions',case when p_payment='pix_manual' then cfg.pix_instructions else '' end);
end $function$

CREATE OR REPLACE FUNCTION public.pitacco_checkout_scheduled_order(p_slug text, p_request uuid, p_customer text, p_phone text, p_address text, p_items jsonb, p_fulfillment text, p_payment text, p_notes text, p_scheduled_for timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_point jsonb := nullif(current_setting('pitacco.checkout_delivery_point',true),'')::jsonb; cfg public.public_menu_settings%rowtype; prior public.public_checkouts%rowtype; item jsonb; product public.products%rowtype; canonical jsonb; normalized jsonb; snapshot jsonb:='[]'; v_phone text; customer text; address text; notes text; quantity integer; option_result jsonb; subtotal numeric:=0; fee numeric; total numeric; oid uuid; token uuid; st text;
begin
 if p_request is null or p_customer is null or length(trim(p_customer)) not between 2 and 120 or p_phone is null or length(p_phone)>30 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') or p_payment is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos';end if;
 if jsonb_array_length(p_items) not between 1 and 30 or octet_length(p_items::text)>12000 then raise exception 'Carrinho invalido';end if;
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');if length(v_phone) not between 10 and 13 then raise exception 'Telefone invalido';end if;
 customer:=public.dg_clean_text(trim(p_customer));address:=public.dg_clean_text(trim(coalesce(p_address,'')));notes:=public.dg_clean_text(trim(coalesce(p_notes,'')));
 if p_fulfillment='delivery' and length(address)<5 then raise exception 'Informe o endereco';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'object' or not item ?& array['product_id','quantity'] or (item-array['product_id','quantity','options'])<>'{}'::jsonb or jsonb_typeof(item->'product_id')<>'string' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity')!~ '^[0-9]+$' then raise exception 'Item invalido';end if;
 quantity:=(item->>'quantity')::integer;if quantity not between 1 and 20 then raise exception 'Quantidade invalida';end if;if item ? 'options' and jsonb_typeof(item->'options')<>'array' then raise exception 'Complementos inválidos';end if;perform(item->>'product_id')::uuid;end loop;
 
  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(line)
    group by (line->>'product_id')::uuid,
      array(select option_id::uuid
            from jsonb_array_elements_text(coalesce(line->'options','[]'::jsonb)) as option_value(option_id)
            order by option_id::uuid)
    having count(*) > 1
  ) then
    raise exception 'Combine itens com os mesmos complementos em uma única linha';
  end if;

 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer,'options',coalesce(value->'options','[]'::jsonb)) order by (value->>'product_id')::uuid, coalesce(value->'options','[]'::jsonb)) into normalized from jsonb_array_elements(p_items);
 canonical:=jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',notes);
 canonical:=canonical||jsonb_build_object('scheduled_for',p_scheduled_for at time zone 'UTC');

 if v_point is not null then canonical:=canonical||jsonb_build_object('delivery_location',v_point); end if;
 select * into cfg from public.public_menu_settings where slug=p_slug for update;if not found then raise exception 'Cardapio indisponivel';end if;
 select * into prior from public.public_checkouts where store_id=cfg.store_id and request_id=p_request;
 if found then
 if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
 return(select jsonb_build_object('order_id',o.id,'tracking_token',prior.tracking_token,'total',o.gross,'status',o.status,'payment_status',case when exists(select 1 from public.manual_payments where order_id=o.id) then 'paid_manual' else 'pending' end,'payment_instructions',prior.payment_instructions) from public.orders o where o.id=prior.order_id);end if;
 perform pitacco_private.require_store_open(cfg.store_id);
 if not cfg.enabled or (p_fulfillment='delivery' and not cfg.delivery_enabled) or (p_fulfillment='pickup' and not cfg.pickup_enabled) or (p_payment<>'fiado' and not p_payment=any(cfg.payment_methods)) then raise exception 'Modalidade indisponivel';end if;
 if exists(select 1 from public.orders where store_id=cfg.store_id and request_id=p_request) then raise exception 'Chave indisponivel';end if;
 if(select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.created_at>now()-interval '1 minute')>=100 or (select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.phone=v_phone and c.created_at>now()-interval '15 minutes')>=5 then raise exception 'Limite temporario de pedidos';end if;

 if not coalesce(p_scheduled_for=any(public.pitacco_public_schedule_slots(p_slug,p_fulfillment)),false) then
  raise exception 'Horário de agendamento indisponível';
 end if;

 perform pitacco_private.enforce_storefront_delivery_area(cfg.store_id,p_fulfillment,v_point);
 for item in select value from jsonb_array_elements(normalized) loop
 select * into product from public.products where id=(item->>'product_id')::uuid and store_id=cfg.store_id and menu_active for share;if not found then raise exception 'Produto indisponivel';end if;
 quantity:=(item->>'quantity')::integer;option_result:=public.pitacco_validate_item_options(cfg.store_id,product.id,item->'options');subtotal:=subtotal+(product.price+(option_result->>'extra')::numeric)*quantity;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',public.dg_clean_text(product.name),'quantity',quantity,'unit_price',product.price,'modifiers',option_result->'modifiers','unit_total',product.price+(option_result->>'extra')::numeric));end loop;
 fee:=pitacco_private.checkout_delivery_fee(cfg.store_id,p_fulfillment,address,p_request,cfg.delivery_fee);total:=subtotal+fee;if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,scheduled_for,scheduled_release_at,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,p_scheduled_for,p_scheduled_for-make_interval(mins => greatest(1,coalesce(cfg.preparation_minutes,30))),jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'delivery_location',v_point,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'delivery_fee_original',fee,'total',total,'discount',0,'notes',notes,'payment',p_payment,'payment_status','pending','scheduled_for',p_scheduled_for,'logistics',case when p_fulfillment='delivery' then 'loja' else 'retirada' end)) returning id into oid;
 insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,payment_instructions) values(oid,cfg.store_id,p_request,canonical,v_phone,case when p_payment='pix_manual' then cfg.pix_instructions else '' end) returning tracking_token into token;
 insert into public.operation_audit(store_id,order_id,actor,action) values(cfg.store_id,oid,auth.uid(),'public_checkout_created');

 select status into st from public.orders where id=oid;
 return jsonb_build_object('order_id',oid,'tracking_token',token,'total',total,'status',st,'payment_status','pending','payment_instructions',case when p_payment='pix_manual' then cfg.pix_instructions else '' end);
end $function$


-- Exige código individual compartilhado pelo lojista. Não aceitamos apenas telefone.
-- Aceita frete cotado e pedido agendado pelo mesmo fluxo de checkout já existente.
create or replace function public.pitacco_checkout_fiado(
 p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,
 p_items jsonb,p_fulfillment text,p_notes text,p_code text,
 p_quote uuid default null,p_scheduled_for timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; data jsonb; currently_due numeric;
begin
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null then return jsonb_build_object('error','Fiado não autorizado nesta loja');end if;
 cid:=pitacco_private.fiado_customer_access(sid,p_phone,p_code);
 if cid is null then return jsonb_build_object('error','Fiado indisponível. Confira autorização, código e limite com a loja.');end if;
 -- Este identificador de conta só existe na transação do checkout autorizado.
 perform set_config('pitacco.fiado_customer',cid::text,true);
 if p_quote is not null then
  data:=public.pitacco_checkout_quoted_delivery(p_slug,p_request,p_customer,p_phone,p_address,
   p_items,p_fulfillment,'fiado',p_notes,p_quote,p_scheduled_for);
 elsif p_scheduled_for is not null then
  data:=public.pitacco_checkout_scheduled_order(p_slug,p_request,p_customer,p_phone,p_address,
   p_items,p_fulfillment,'fiado',p_notes,p_scheduled_for);
 else
  data:=public.checkout_public_order(p_slug,p_request,p_customer,p_phone,p_address,
   p_items,p_fulfillment,'fiado',p_notes);
 end if;
 perform set_config('pitacco.fiado_customer','',true);
 return coalesce(data,'{}'::jsonb)||jsonb_build_object('payment_status','fiado');
end $$;
revoke all on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) from public;
grant execute on function public.pitacco_checkout_fiado(text,uuid,text,text,text,jsonb,text,text,text,uuid,timestamptz) to anon,authenticated;
