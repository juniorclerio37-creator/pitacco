-- Preserva cálculos, limites e idempotência; respeita também o início configurado.
do $migration$
declare checkout regprocedure; definition text;
 original constant text := 'and active and (expires_at is null or expires_at>now())';
 replacement constant text := 'and active and (starts_at is null or starts_at<=now()) and (expires_at is null or expires_at>now())';
begin
 foreach checkout in array array[
  'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure,
  'public.pitacco_checkout_scheduled_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text,timestamptz)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(checkout);
  if strpos(definition,replacement)>0 then continue;end if;
  if strpos(definition,original)=0 then
   raise exception 'Checkout % difere da versão verificada; nenhuma substituição insegura',checkout;
  end if;
  execute replace(definition,original,replacement);
 end loop;
end $migration$;
