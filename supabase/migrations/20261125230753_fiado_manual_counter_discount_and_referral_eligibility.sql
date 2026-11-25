-- Reject any coupon applied to a credit purchase, including direct RPC calls.
do $migration$
declare f regprocedure; def text;
begin
 foreach f in array array[
 'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
 'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
 def:=pg_get_functiondef(f);
 if strpos(def,'if p_request is null')=0 then raise exception 'Coupon checkout anchor missing';end if;
 execute replace(def,'if p_request is null',$a$if lower(coalesce(p_payment,''))='fiado' then raise exception 'Fiado não aceita cupom de desconto';end if;
 if p_request is null$a$);
 end loop;
end $migration$;
-- Fiado purchases do not consume the first eligible referral purchase.
do $migration$
declare def text:=pg_get_functiondef('pitacco_private.loyalty_customer_for_order(uuid,text,text,text)'::regprocedure);
 anchor constant text:=$a$prior_purchase:=exists(select 1 from public.public_checkouts pc where pc.store_id=s
  and pc.phone in (v_phone,'55'||v_phone));$a$;
begin
 if strpos(def,anchor)=0 then raise exception 'Referral purchase anchor missing';end if;
 execute replace(def,anchor,$a$prior_purchase:=exists(select 1 from public.public_checkouts pc join public.orders o on o.id=pc.order_id and o.store_id=pc.store_id where pc.store_id=s
  and pc.phone in (v_phone,'55'||v_phone)
  and lower(coalesce(o.receipt->>'payment',''))<>'fiado'
  and not exists(select 1 from public.pitacco_fiado_charges fc where fc.order_id=o.id and fc.store_id=s));$a$);
end $migration$;
-- New manager-only counter RPC: the discount is in reais, not a coupon or reward.
do $migration$
declare def text:=pg_get_functiondef('public.pitacco_fiado_balcao_create(uuid,uuid,uuid,jsonb,text)'::regprocedure);
begin
 def:=replace(def,'public.pitacco_fiado_balcao_create(','public.pitacco_fiado_balcao_discount(');
 def:=replace(def,'p_note text DEFAULT ''''::text)','p_note text, p_discount numeric)');
 def:=replace(def,'oid uuid; prior public.orders%rowtype;','oid uuid; prior public.orders%rowtype; net numeric;');
 def:=replace(def,'if p_request is null or',$a$if p_discount is null or p_discount<0 or p_discount>10000 or p_discount<>round(p_discount,2) then raise exception 'Desconto manual inválido';end if;
 if p_request is null or$a$);
 def:=replace(def,$a$or prior.receipt->'pdv_requested_items' is distinct from p_items then$a$,$a$or prior.receipt->'pdv_requested_items' is distinct from p_items
 or coalesce((prior.receipt->>'manual_discount')::numeric,0)<>p_discount
 or coalesce(prior.receipt->>'merchant_sale_mode','balcao')<>'balcao' then$a$);
 def:=replace(def,'-- O trigger de reserva faz',$a$if p_discount>=subtotal then raise exception 'Desconto deve ser inferior ao subtotal';end if;
 net:=subtotal-p_discount;
 -- O trigger de reserva faz$a$);
 def:=replace(def,$a$values(p_store,'Delivery próprio',subtotal,'proprio',$a$,$a$values(p_store,'Delivery próprio',net,'proprio',$a$);
 def:=replace(def,$a$'total',subtotal,'notes'$a$,$a$'total',net,'discount',p_discount,'manual_discount',p_discount,'discount_origin','manual_balcao','merchant_sale_mode','balcao','sales_channel','venda_direta','notes'$a$);
 def:=replace(def,$a$'amount',subtotal)$a$,$a$'amount',net,'subtotal',subtotal,'manual_discount',p_discount)$a$);
 def:=replace(def,$a$'total',subtotal,'duplicate',false$a$,$a$'total',net,'discount',p_discount,'duplicate',false$a$);
 if strpos(def,'p_discount numeric)')=0 or strpos(def,'net:=subtotal-p_discount;')=0 or strpos(def,$a$'total',net,'discount',p_discount$a$)=0 then raise exception 'Manual discount anchors missing';end if;
 execute def;
end $migration$;
revoke all on function public.pitacco_fiado_balcao_discount(uuid,uuid,uuid,jsonb,text,numeric) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_balcao_discount(uuid,uuid,uuid,jsonb,text,numeric) to authenticated;
notify pgrst,'reload schema';
