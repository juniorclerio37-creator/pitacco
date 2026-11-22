-- Produção possui dados de contato do entregador; fixtures antigas de PostgreSQL
-- não possuem essa tabela. Não recriar suas tabelas nem quebrar migrations alheias.
do $pitacco_privacy$
begin
 if to_regclass('public.pitacco_delivery_customer_contacts') is not null then
  execute $definition$
CREATE OR REPLACE FUNCTION public.pitacco_driver_order_detail(p_delivery uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_delivery public.deliveries%rowtype;
  v_contact public.pitacco_delivery_customer_contacts%rowtype;
  v_receipt jsonb := '{}'::jsonb;
  v_customer jsonb := '{}'::jsonb;
  v_checkout_phone text;
  v_phone text;
  v_digits text;
  v_kind text := 'unknown';
  v_locator text;
  v_expires text;
  v_source text;
  v_items jsonb := '[]'::jsonb;
  v_gross numeric;
  v_payment text;
  v_payment_status text;
  v_order_display text;
  v_extra_notes text;
begin
  if p_delivery is null or (select auth.uid()) is null
     or not public.pitacco_courier_session_ready() then
    raise exception 'Sessão do entregador não autorizada' using errcode = '42501';
  end if;

  select d.* into v_delivery
    from public.deliveries d
    join public.couriers c
      on c.id = d.courier_id and (c.store_id = d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))
   where d.id = p_delivery
     and c.user_id = (select auth.uid())
     and c.active = true
     and d.logistics_provider = 'loja'
     and d.status not in ('entregue','cancelada')
   limit 1;

  if not found then
    raise exception 'Pedido não atribuído ou contato indisponível' using errcode = '42501';
  end if;

  select coalesce(o.receipt,'{}'::jsonb), o.gross
    into v_receipt, v_gross
    from public.orders o
   where o.id = v_delivery.order_id and o.store_id = v_delivery.store_id
   limit 1;
  v_receipt := coalesce(v_receipt,'{}'::jsonb);
  if pg_catalog.jsonb_typeof(v_receipt->'customer')='object' then
    v_customer := v_receipt->'customer';
  end if;

  select co.* into v_contact
    from public.pitacco_delivery_customer_contacts co
   where co.delivery_id = v_delivery.id
     and co.store_id = v_delivery.store_id
   limit 1;

  select pc.phone into v_checkout_phone
    from public.public_checkouts pc
   where pc.order_id = v_delivery.order_id and pc.store_id = v_delivery.store_id
   order by pc.created_at desc
   limit 1;

  v_phone := nullif(pg_catalog.btrim(coalesce(
    nullif(v_contact.phone_number,''),
    nullif(v_customer->'phone'->>'number',''),
    case when pg_catalog.jsonb_typeof(v_customer->'phone')='string' then v_customer->>'phone' else null end,
    nullif(v_receipt->>'customer_phone',''),
    nullif(v_receipt->>'customerPhone',''),
    nullif(v_checkout_phone,'')
  )), '');
  v_locator := nullif(pg_catalog.btrim(coalesce(
    nullif(v_contact.phone_localizer,''),
    nullif(v_customer->'phone'->>'localizer',''),
    nullif(v_customer->>'localizer',''),
    nullif(v_receipt->'phone'->>'localizer',''),
    nullif(v_receipt->>'phone_localizer',''),
    nullif(v_receipt->>'localizer','')
  )), '');
  v_expires := coalesce(
    v_contact.phone_expires_at::text,
    nullif(v_customer->'phone'->>'localizerExpiration',''),
    nullif(v_receipt->>'phone_localizer_expiration','')
  );

  v_digits := pg_catalog.regexp_replace(coalesce(v_phone,''),'[^0-9]','','g');
  if v_digits ~ '^0(800|300|303|900)[0-9]+$' then
    v_kind := 'intermediary';
  elsif v_digits ~ '^55[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$'
     or v_digits ~ '^[1-9][0-9](9[0-9]{8}|[2-9][0-9]{7})$' then
    v_kind := 'real';
  elsif v_phone is null then
    v_kind := 'none';
  end if;

  if v_expires is not null and pg_catalog.pg_input_is_valid(v_expires,'timestamp with time zone') then
    if v_expires::timestamptz < pg_catalog.now() then
      v_phone := null;
      v_kind := 'expired';
      v_locator := null;
    end if;
  end if;

  -- A lista é limitada aos campos relevantes ao entregador; não retorna receipt bruto.
  if pg_catalog.jsonb_typeof(v_receipt->'items')='array' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', coalesce(nullif(i.value->>'name',''),nullif(i.value->>'title',''),'Produto'),
      'quantity', coalesce(i.value->>'quantity','1'),
      'notes', coalesce(i.value->>'notes',i.value->>'observations',''),
      'options', (
        select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', case when pg_catalog.jsonb_typeof(m.value)='string'
                     then pg_catalog.btrim(m.value::text, pg_catalog.chr(34))
                     else coalesce(nullif(m.value->>'name',''),nullif(m.value->>'title',''),
                                   m.value->'option'->>'name','') end,
          'quantity', case when pg_catalog.jsonb_typeof(m.value)='object'
                          then coalesce(m.value->>'quantity','1')
                          else '1' end
        ) order by m.ordinality),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(
          case
            when pg_catalog.jsonb_typeof(i.value->'modifiers')='array' then i.value->'modifiers'
            when pg_catalog.jsonb_typeof(i.value->'options')='array' then i.value->'options'
            when pg_catalog.jsonb_typeof(i.value->'complements')='array' then i.value->'complements'
            else '[]'::jsonb end
        ) with ordinality as m(value,ordinality)
      )
    ) order by i.ordinality),'[]'::jsonb)
    into v_items
    from pg_catalog.jsonb_array_elements(v_receipt->'items') with ordinality as i(value,ordinality);
  end if;

  v_source := coalesce(nullif(v_delivery.source,''),nullif(v_receipt->>'source',''),'proprio');
  v_payment := case
    when pg_catalog.jsonb_typeof(v_receipt->'payment')='string' then v_receipt->>'payment'
    when pg_catalog.jsonb_typeof(v_receipt->'payment')='object' then v_receipt->'payment'->>'method'
    else null end;
  v_payment_status := nullif(v_receipt->>'payment_status','');
  -- O entregador não deve conhecer a existência de fiado. Não retornar valor,
  -- saldo, forma financeira ou estado 'fiado' mesmo na RPC dos detalhes.
  if lower(coalesce(v_receipt->>'payment',''))='fiado' or
     lower(coalesce(v_receipt->>'payment_method',''))='fiado' then
     v_payment:='Sem cobrança na entrega';
     v_payment_status:='no_collect';
  end if;
  v_order_display := coalesce(
    public.pitacco_order_public_label(v_receipt, coalesce(v_source,v_delivery.source)),
    'Aguardando número');
  v_extra_notes := coalesce(nullif(v_delivery.notes,''),nullif(v_receipt->>'notes',''),'');
  return pg_catalog.jsonb_build_object(
    'delivery_id', v_delivery.id,
    'order_id', v_delivery.order_id,
    'display_number', v_order_display,
    'status', v_delivery.status,
    'source', v_source,
    'customer_name', coalesce(nullif(v_delivery.customer_name,''),nullif(v_customer->>'name',''),'Cliente'),
    'address', v_delivery.address,
    'notes', v_extra_notes,
    'items', coalesce(v_items,'[]'::jsonb),
    'total', v_gross,
    'payment_method', v_payment,
    'payment_status', v_payment_status,
    'contact', pg_catalog.jsonb_build_object(
      'number', v_phone,
      'kind', v_kind,
      'localizer', v_locator,
      'expires_at', v_expires
    )
  );
end $function$;
$definition$;
 end if;
end $pitacco_privacy$;
