
-- PDV / balcão: preços e complementos calculados no servidor como no cardápio.
-- Funciona somente para gestor autorizado da própria loja.
create or replace function public.pitacco_fiado_balcao_create(
 p_store uuid,p_customer uuid,p_request uuid,p_items jsonb,p_note text default ''
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.pitacco_fiado_customers%rowtype;
 item jsonb; product public.products%rowtype; options jsonb;
 quantity integer; subtotal numeric:=0; snapshot jsonb:='[]'::jsonb;
 oid uuid; prior public.orders%rowtype;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente gestor pode registrar fiado de balcão' using errcode='42501';end if;
 if p_request is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 30
    or octet_length(p_items::text)>12000 or length(coalesce(p_note,''))>1000 then
  raise exception 'Itens do balcão inválidos' using errcode='22023';end if;
 select * into account from public.pitacco_fiado_customers
  where id=p_customer and store_id=p_store for update;
 if not found or not account.enabled then raise exception 'Cliente não autorizado para fiado' using errcode='42501';end if;
 -- request_id é imutável e idempotente sob o lock da conta do cliente.
 select * into prior from public.orders
  where store_id=p_store and request_id=p_request;
 if found then
  if prior.receipt->>'payment'<>'fiado' or prior.receipt->>'fiado_customer_id'<>account.id::text
    or prior.receipt->'pdv_requested_items' is distinct from p_items then
   raise exception 'Identificador do pedido já utilizado com dados diferentes';end if;
  return jsonb_build_object('order_id',prior.id,'total',prior.gross,'duplicate',true);
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or not(item ?& array['product_id','quantity'])
    or (item-array['product_id','quantity','options'])<>'{}'::jsonb
    or (item->>'quantity')!~ '^[0-9]+$' then
   raise exception 'Item do balcão inválido' using errcode='22023';end if;
  quantity:=(item->>'quantity')::int;
  if quantity not between 1 and 20 then raise exception 'Quantidade inválida';end if;
  select * into product from public.products where id=(item->>'product_id')::uuid
    and store_id=p_store and menu_active;
  if not found then raise exception 'Produto indisponível nesta loja';end if;
  options:=public.pitacco_validate_item_options(p_store,product.id,
    coalesce(item->'options','[]'::jsonb));
  subtotal:=subtotal+quantity*(product.price+(options->>'extra')::numeric);
  snapshot:=snapshot||jsonb_build_array(jsonb_build_object('product_id',product.id,
   'name',product.name,'quantity',quantity,'unit_price',product.price,
   'modifiers',options->'modifiers','unit_total',product.price+(options->>'extra')::numeric));
 end loop;
 if subtotal<=0 or subtotal>10000 then raise exception 'Valor do pedido inválido';end if;
 -- O trigger de reserva faz a checagem atômica do limite e do vencimento.
 perform set_config('pitacco.fiado_customer',account.id::text,true);
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt)
 values(p_store,'Delivery próprio',subtotal,'proprio','pending',p_request,
  jsonb_build_object('customer',account.name,'phone',account.phone,
   'address','','items',snapshot,'subtotal',subtotal,'delivery_fee',0,
   'total',subtotal,'notes',coalesce(p_note,''),'payment','fiado',
   'payment_status','fiado','logistics','retirada','point_of_sale',true,
   'pdv_requested_items',p_items))
 returning id into oid;
 perform set_config('pitacco.fiado_customer','',true);
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(p_store,oid,auth.uid(),'fiado_balcao_created',
  jsonb_build_object('customer',account.id,'amount',subtotal));
 return jsonb_build_object('order_id',oid,'total',subtotal,'duplicate',false,
  'approval_required',account.approval_mode='manual');
end $$;
revoke all on function public.pitacco_fiado_balcao_create(uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.pitacco_fiado_balcao_create(uuid,uuid,uuid,jsonb,text) to authenticated;
