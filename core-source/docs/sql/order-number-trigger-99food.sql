CREATE OR REPLACE FUNCTION public.pitacco_assign_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pref text; seq bigint; external_no text;
begin
 if new.source in ('ifood','99food','keeta') then
  -- Never promote 99Food's opaque receipt.number technical ID into a public display number.
  external_no:=nullif(pg_catalog.btrim(coalesce(
    new.receipt->>'external_order_number',
    new.receipt->>'order_number',
    new.receipt->>'display_id',
    case when new.source='99food' then null else new.receipt->>'number' end,
    ''
  )),'');
  if external_no is not null then
   new.receipt:=jsonb_set(coalesce(new.receipt,'{}'::jsonb),'{display_number}',to_jsonb(external_no),true);
  end if;
  return new;
 end if;
 if new.source<>'proprio' then return new; end if;
 if nullif(new.receipt->>'display_number','') is not null then return new; end if;
 pref:=case when new.receipt->>'sales_channel'='balcao' then 'B' else 'D' end;
 insert into public.pitacco_order_sequences(store_id,prefix,last_number)
 values(new.store_id,pref,1001)
 on conflict(store_id,prefix) do update set last_number=public.pitacco_order_sequences.last_number+1
 returning last_number into seq;
 new.receipt:=jsonb_set(coalesce(new.receipt,'{}'::jsonb),'{display_number}',to_jsonb(pref||'-'||seq::text),true);
 return new;
end $function$
;
