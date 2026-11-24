-- Troco do checkout: dados financeiros estruturados, sem modificar pedidos antigos.
-- Extrai também o sufixo legado "Troco para: R$ 50" das observações do V2.
create or replace function pitacco_private.cash_change_for(p_receipt jsonb,p_total numeric)
returns numeric language plpgsql immutable set search_path='' as $cash$
declare
 r jsonb:=coalesce(p_receipt,'{}'::jsonb);
 raw text; pieces text[]; given numeric; method text;
begin
 method:=lower(btrim(coalesce(nullif(r->>'payment_method',''),
  nullif(r->'payment'->>'method',''),r->>'payment','')));
 if method not in ('dinheiro','cash','cod') then return null;end if;
 raw:=coalesce(nullif(r->>'change_for',''),nullif(r->>'troco_para',''),
  nullif(r->>'cash_given',''));
 if raw is null then
  pieces:=pg_catalog.regexp_match(coalesce(r->>'notes',''),
    '(^|[[:space:]])Troco para:[[:space:]]*R\$[[:space:]]*([0-9]{1,7}([.,][0-9]{1,2})?)[[:space:]]*$','i');
  if pieces is not null then raw:=pieces[2];end if;
 end if;
 if raw is null or raw !~ '^[0-9]{1,7}([.,][0-9]{1,2})?$' then return null;end if;
 given:=replace(raw,',','.')::numeric;
 if given<p_total or given>10000000 then return null;end if;
 return round(given,2);
end $cash$;

create or replace function pitacco_private.attach_cash_change_at_checkout()
returns trigger language plpgsql set search_path='' as $trigger$
declare
 v_change numeric;v_note text;v_explicit boolean;
begin
 if new.source<>'proprio' or new.receipt is null
  or lower(coalesce(new.receipt->>'payment','')) not in ('dinheiro','cash','cod')
 then return new;end if;
 v_note:=coalesce(new.receipt->>'notes','');
 v_explicit:=new.receipt ? 'change_for' or new.receipt ? 'troco_para' or
  pg_catalog.regexp_match(v_note,
    '(^|[[:space:]])Troco para:[[:space:]]*R\$[[:space:]]*[0-9]{1,7}([.,][0-9]{1,2})?[[:space:]]*$','i') is not null;
 v_change:=pitacco_private.cash_change_for(new.receipt,new.gross);
 if v_explicit and v_change is null then
  raise exception 'O valor para troco precisa ser igual ou superior ao total do pedido, incluindo entrega e descontos';
 end if;
 if v_change is null then return new;end if;
 new.receipt:=pg_catalog.jsonb_set(new.receipt,'{change_for}',pg_catalog.to_jsonb(v_change),true);
 new.receipt:=pg_catalog.jsonb_set(new.receipt,'{change_due}',
  pg_catalog.to_jsonb(round(v_change-new.gross,2)),true);
 v_note:=pg_catalog.btrim(pg_catalog.regexp_replace(v_note,
  '(^|[[:space:]])Troco para:[[:space:]]*R\$[[:space:]]*[0-9]{1,7}([.,][0-9]{1,2})?[[:space:]]*$','','i'));
 new.receipt:=pg_catalog.jsonb_set(new.receipt,'{notes}',pg_catalog.to_jsonb(v_note),true);
 return new;
end $trigger$;

drop trigger if exists pitacco_cash_change_at_checkout on public.orders;
create trigger pitacco_cash_change_at_checkout
before insert on public.orders
for each row execute function pitacco_private.attach_cash_change_at_checkout();

-- Lembrete, cartões e detalhes do entregador obtêm os mesmos valores.
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
 -- Campos novos são estruturados; para pedidos anteriores, ler a
 -- observação explícita apenas em pagamento por dinheiro.
 changeto:=pitacco_private.cash_change_for(r,amount);
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
end $function$;
