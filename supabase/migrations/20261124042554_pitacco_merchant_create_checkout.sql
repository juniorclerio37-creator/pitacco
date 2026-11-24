create or replace function public.pitacco_merchant_create_checkout(
 p_store uuid,p_request uuid,p_sale_mode text,p_customer text,p_phone text,p_address text,
 p_items jsonb,p_payment text,p_notes text default '',p_coupon text default '',
 p_quote uuid default null,p_fiado_customer uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare slug text; result jsonb; oid uuid; prior public.orders%rowtype; fulfillment text;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão para registrar venda' using errcode='42501';end if;
 if p_request is null or p_sale_mode is null or p_sale_mode not in ('balcao','retirada','entrega') then raise exception 'Modalidade inválida';end if;
 if p_sale_mode='entrega' and p_quote is null then raise exception 'Calcule o frete antes de confirmar';end if;
 if p_sale_mode<>'entrega' and p_quote is not null then raise exception 'Cotação exclusiva para entrega';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||p_request::text,0));
 select * into prior from public.orders where store_id=p_store and request_id=p_request;
 if found and prior.receipt->>'merchant_sale_mode' is distinct from p_sale_mode then raise exception 'Identificador já utilizado em outra venda';end if;
 if p_payment='fiado' then
  if p_sale_mode='entrega' or p_fiado_customer is null or coalesce(trim(p_coupon),'')<>'' then raise exception 'Fiado de balcão exige cliente autorizado e não aceita cupom';end if;
  result:=public.pitacco_fiado_balcao_create(p_store,p_fiado_customer,p_request,p_items,p_notes);
 else
  select m.slug into slug from public.public_menu_settings m where m.store_id=p_store and m.enabled;
  if slug is null then raise exception 'Publique o cardápio para utilizar esta venda integrada';end if;
  fulfillment:=case when p_sale_mode='entrega' then 'delivery' else 'pickup' end;
  if pitacco_private.loyalty_available(p_store) then
   result:=public.pitacco_loyalty_checkout(slug,p_request,p_customer,p_phone,p_address,p_items,fulfillment,p_payment,p_notes,'',coalesce(p_coupon,''),'',p_quote,null,null);
  elsif coalesce(trim(p_coupon),'')<>'' then raise exception 'Cupons indisponíveis nesta loja';
  elsif p_sale_mode='entrega' then
   result:=public.pitacco_checkout_quoted_delivery(slug,p_request,p_customer,p_phone,p_address,p_items,fulfillment,p_payment,p_notes,p_quote,null);
  else
   result:=public.checkout_public_order(slug,p_request,p_customer,p_phone,p_address,p_items,fulfillment,p_payment,p_notes);
  end if;
 end if;
 if result?'error' then return result;end if;
 oid:=(result->>'order_id')::uuid;
 if oid is null or not exists(select 1 from public.orders where id=oid and store_id=p_store and request_id=p_request) then raise exception 'Venda não confirmada';end if;
 if prior.id is null then
  update public.orders set receipt=receipt||jsonb_build_object('merchant_sale_mode',p_sale_mode,'sales_channel','venda_direta','point_of_sale',true) where id=oid and store_id=p_store;
  insert into public.operation_audit(store_id,order_id,actor,action,details) values(p_store,oid,auth.uid(),'merchant_sale_created',jsonb_build_object('mode',p_sale_mode));
 end if;
 return result;
end $$;
revoke all on function public.pitacco_merchant_create_checkout(uuid,uuid,text,text,text,text,jsonb,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_merchant_create_checkout(uuid,uuid,text,text,text,text,jsonb,text,text,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';