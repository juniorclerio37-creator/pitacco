-- Keep the deployed checkout rules and their grants. Only change line identity
-- and ordering. Requests with one line per product retain their saved payload.
do $migration$
declare
  checkout regprocedure;
  definition text;
  previous_check constant text := $sql$if(select count(distinct(value->>'product_id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Produto repetido';end if;$sql$;
  variant_check constant text := $sql$
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
$sql$;
  previous_sort constant text := $sql$order by(value->>'product_id')::uuid) into normalized$sql$;
  variant_sort constant text := $sql$order by (value->>'product_id')::uuid, coalesce(value->'options','[]'::jsonb)) into normalized$sql$;
begin
  foreach checkout in array array[
    'public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure,
    'public.checkout_public_order_coupon(text,uuid,text,text,text,jsonb,text,text,text,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(checkout);
    if strpos(definition, variant_check) > 0 and strpos(definition, variant_sort) > 0 then
      continue;
    end if;
    if strpos(definition, previous_check) = 0 or strpos(definition, previous_sort) = 0
       or strpos(definition, '''options'',coalesce(value->''options'',''[]''::jsonb)') = 0 then
      raise exception 'Checkout % difere da versão de referência', checkout;
    end if;
    execute replace(replace(definition, previous_check, variant_check), previous_sort, variant_sort);
  end loop;
end;
$migration$;
