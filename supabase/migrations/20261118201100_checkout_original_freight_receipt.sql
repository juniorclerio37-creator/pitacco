-- Guard the originally quoted fee at checkout, before any present or
-- future promotion can change the customer-paid delivery fee.
do $$
declare f regprocedure; definition text;
 old_key constant text := $needle$'delivery_fee',fee,'total',total$needle$;
 new_key constant text := $needle$'delivery_fee',fee,'delivery_fee_original',fee,'total',total$needle$;
begin
 foreach f in array array[
  'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
  'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
  'public.pitacco_checkout_scheduled_order(text,uuid,text,text,text,jsonb,text,text,text,timestamptz)'::regprocedure,
  'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
  definition:=pg_catalog.pg_get_functiondef(f);
  if pg_catalog.strpos(definition,new_key)>0 then continue;end if;
  if pg_catalog.strpos(definition,old_key)=0 then
   raise exception 'Checkout % não corresponde à versão de frete aprovada',f;
  end if;
  execute pg_catalog.replace(definition,old_key,new_key);
 end loop;
end $$;
