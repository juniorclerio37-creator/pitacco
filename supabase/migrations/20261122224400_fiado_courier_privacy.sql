-- O motoboy não vê fiado, dívidas, limites ou vencimentos; sabe apenas que não deve cobrar.
CREATE OR REPLACE FUNCTION pitacco_private.courier_payment_details(p_receipt jsonb, p_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
 r jsonb:=coalesce(p_receipt,'{}'::jsonb);
 m text;
 s text;
 timing text;
 amount numeric:=coalesce(p_total,0);
 changeto numeric:=null;
 already boolean;
 providerpaid boolean;
 collect boolean;
 amttext text;
 changetext text;
begin
 -- Isolamento: o entregador não recebe a modalidade fiado, limite nem saldo.
 if lower(coalesce(r->>'payment',''))='fiado' or
   lower(coalesce(r->>'payment_method',''))='fiado' then
  return pg_catalog.jsonb_build_object(
   'state','no_collect','method','Sem cobrança na entrega',
   'amount',null,'change_for',null,'change_due',null,
   'received_by_courier',false,'received_at',null);
 end if;
 m:=lower(pg_catalog.btrim(coalesce(nullif(r->>'payment_method',''),nullif(r->'payment'->>'method',''),
   case when jsonb_typeof(r->'payment')='string' then r->>'payment' else null end,
   nullif(r->>'payment_type',''),'')));
 s:=lower(pg_catalog.btrim(coalesce(nullif(r->>'payment_status',''),r->'payment'->>'status','')));
 timing:=lower(coalesce(r->>'payment_timing','')||' '||coalesce(r->>'payment_when','')||' '||
   coalesce(r->>'payment_location','')||' '||coalesce(r->>'payment_channel',''));
 already:=coalesce(r->'courier_collection'->>'received','false')='true';
 providerpaid:=coalesce(r->>'payment_confirmed','false')='true' or coalesce(r->>'paid','false')='true'
    or coalesce(r->>'is_paid','false')='true'
    or s in ('paid','approved','captured','confirmed','settled','pago','aprovado');
 collect:=not (already or providerpaid) and (
    coalesce(r->>'payment_on_delivery','false')='true'
    or coalesce(r->>'collect_on_delivery','false')='true'
    or timing ~ '(entrega|delivery|on.arrival|na_entrega|offline)'
    or m ~ '(^|[^a-z])(dinheiro|cash|cod|na entrega)([^a-z]|$)'
    or m in ('cartao_entrega','cartao_na_entrega','card_on_delivery')
 );
 if coalesce(r->>'payment_on_delivery','')='false' and coalesce(r->>'collect_on_delivery','')='false'
   then collect:=false;
 end if;
 amttext:=coalesce(nullif(r->>'amount_to_collect',''),nullif(r->>'amount_due',''));
 if amttext is not null and amttext ~ '^[0-9]+(\.[0-9]{1,2})?$'
    then amount:=amttext::numeric; end if;
 changetext:=coalesce(nullif(r->>'change_for',''),nullif(r->>'troco_para',''),nullif(r->>'cash_given',''));
 if changetext is not null and changetext ~ '^[0-9]+(\.[0-9]{1,2})?$'
    then changeto:=changetext::numeric; end if;
 return pg_catalog.jsonb_build_object(
  'state',case when already or providerpaid then 'paid'
    when collect and amount>0 then 'collect' else 'unknown' end,
  'method',case
    when m in ('cartao_entrega','cartao_na_entrega','card_on_delivery') then 'Cartão na entrega'
    when m in ('dinheiro','cash','cod') then 'Dinheiro'
    when m in ('pix','pix_manual') then 'Pix'
    when m in ('cartao','card') then 'Cartão'
    when m in ('credit_card','cartao_credito','credit') or m like '%credit%' then 'Cartão de crédito'
    when m in ('debit_card','cartao_debito','debit') or m like '%debit%' then 'Cartão de débito'
    when m='online' then 'Online'
    when m='' then 'Não informada' else left(m,70) end,
  'amount',amount,'change_for',changeto,
  'change_due',case when changeto is not null then greatest(changeto-amount,0) else null end,
  'received_by_courier',already,
  'received_at',r->'courier_collection'->>'received_at'
 );
end $function$

