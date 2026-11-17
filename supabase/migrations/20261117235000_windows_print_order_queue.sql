-- Pitacco 0.12.6: recover order printing when Windows printer tests succeed
-- but no job reaches the spooler. Preserve existing printers and print history.
--
-- The old dg_receipt_text could coerce JSON string modifiers into JSON values
-- during concatenation, producing "invalid input syntax for type json" and
-- aborting reprint_order before a job was queued.

create or replace function public.dg_receipt_text(r jsonb)
returns text language plpgsql immutable set search_path=''
as $receipt$
declare
  result text := 'PITACCO' || pg_catalog.chr(10);
  item jsonb;
  modifier jsonb;
  label text;
  quantity text;
  mods jsonb;
  customer text;
  payment text;
  display_num text;
begin
  if r is null or pg_catalog.jsonb_typeof(r)<>'object' then
    return result || 'Dados da comanda indisponiveis' || pg_catalog.chr(10);
  end if;
  display_num := coalesce(
    nullif(r->>'display_number',''),
    nullif(r->>'external_order_number',''),
    nullif(r->>'order_number',''),
    nullif(r->>'display_id',''),
    nullif(r->>'number',''),'');
  customer := case when pg_catalog.jsonb_typeof(r->'customer')='object'
    then coalesce(r->'customer'->>'name','')
    else coalesce(r->>'customer',r->>'customer_name','') end;
  payment := case when pg_catalog.jsonb_typeof(r->'payment')='object'
    then coalesce(r->'payment'->>'method','')
    else coalesce(r->>'payment',r->>'payment_method','') end;
  result := result
    || 'Pedido: ' || display_num || pg_catalog.chr(10)
    || 'Origem: ' || coalesce(r->>'source','') || pg_catalog.chr(10)
    || 'Cliente: ' || customer || pg_catalog.chr(10);
  if coalesce(r->>'phone',r->>'customer_phone','') <> '' then
    result := result || 'Telefone: ' || coalesce(r->>'phone',r->>'customer_phone','') || pg_catalog.chr(10);
  end if;
  for item in select e.value
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(r->'items')='array' then r->'items' else '[]'::jsonb end
    ) as e(value)
  loop
    if pg_catalog.jsonb_typeof(item)<>'object' then continue; end if;
    result := result
      || coalesce(item->>'quantity','1')
      || ' x ' || coalesce(item->>'name',item->>'title','Produto')
      || pg_catalog.chr(10);
    mods := case
      when pg_catalog.jsonb_typeof(item->'modifiers')='array' then item->'modifiers'
      when pg_catalog.jsonb_typeof(item->'options')='array' then item->'options'
      when pg_catalog.jsonb_typeof(item->'complements')='array' then item->'complements'
      else '[]'::jsonb end;
    for modifier in select m.value from pg_catalog.jsonb_array_elements(mods) as m(value)
    loop
      if pg_catalog.jsonb_typeof(modifier)='object' then
        label:=coalesce(modifier->>'name',modifier->>'title',modifier->'option'->>'name','');
        quantity:=coalesce(modifier->>'quantity','1');
      elsif pg_catalog.jsonb_typeof(modifier)='string' then
        label:=modifier #>> '{}'::text[];
        quantity:='1';
      else
        continue;
      end if;
      if nullif(pg_catalog.btrim(label),'') is not null then
        -- Explicitly text values: never ask the JSON concatenation operator
        -- to parse a plain modifier name as JSON.
        result := result || ' + ' || quantity || ' x ' || label || pg_catalog.chr(10);
      end if;
    end loop;
    if coalesce(item->>'notes','')<>'' then
      result := result || 'Obs: ' || (item->>'notes') || pg_catalog.chr(10);
    end if;
  end loop;
  result:=result || 'Subtotal: R$ ' || coalesce(r->>'subtotal','0') || pg_catalog.chr(10)
    || 'Entrega: R$ ' || coalesce(r->>'delivery_fee','0') || pg_catalog.chr(10)
    || 'Desconto: R$ ' || coalesce(r->>'discount','0') || pg_catalog.chr(10)
    || 'TOTAL: R$ ' || coalesce(r->>'total',r->>'total_amount','0') || pg_catalog.chr(10)
    || 'Pagamento: ' || payment || pg_catalog.chr(10)
    || 'Situacao: ' || coalesce(r->>'payment_status','nao confirmado') || pg_catalog.chr(10)
    || 'Endereco: ' || coalesce(r->>'address','') || pg_catalog.chr(10)
    || 'Observacoes: ' || coalesce(r->>'notes','') || pg_catalog.chr(10);
  return result;
end;
$receipt$;

-- Reconcile missed automatic iFood print jobs ONLY while confirmation is fresh.
-- Does not print historical, cancelled, provider-CONCLUDED or already dispatched
-- orders. Old jobs, reprint receipts, and their audit history remain untouched.
create or replace function pitacco_private.pitacco_ensure_fresh_ifood_print_jobs()
returns trigger language plpgsql security definer set search_path=''
as $fresh$
begin
  if new.source<>'ifood' or new.status<>'accepted'
    or new.receipt->>'ifood_status' not in ('CONFIRMED','READY_TO_PICKUP')
    or new.accepted_at is null
    or new.accepted_at < pg_catalog.now()-interval '30 minutes'
    or new.accepted_at > pg_catalog.now()+interval '5 minutes'
  then return new; end if;
  insert into public.print_jobs (
    store_id,order_id,sector,printer,width,copy_no,receipt,receipt_text
  )
  select new.store_id,new.id,s.sector,s.printer,s.width,n,
    new.receipt,
    public.dg_receipt_text(
      new.receipt || pg_catalog.jsonb_build_object(
        'source','ifood','number',coalesce(new.receipt->>'display_number',new.id::text)
      )
    ) || 'Setor: ' || public.dg_clean_text(s.sector)
      || ' Via: ' || n::text || pg_catalog.chr(10)
  from public.print_sectors s
  cross join lateral pg_catalog.generate_series(1,s.copies) n
  where s.store_id=new.store_id and s.enabled
    and (pg_catalog.cardinality(s.sources)=0 or 'ifood'=any(s.sources))
    and not exists (
      select 1 from public.print_jobs j where j.order_id=new.id
        and j.sector=s.sector and j.copy_no=n
    )
  on conflict do nothing;
  return new;
end;
$fresh$;

drop trigger if exists pitacco_ensure_fresh_ifood_print_jobs on public.orders;
create trigger pitacco_ensure_fresh_ifood_print_jobs
after insert or update of status,receipt on public.orders
for each row execute function pitacco_private.pitacco_ensure_fresh_ifood_print_jobs();

-- Verify the exact JSON shape that caused an iFood reprint failure.
do $smoke$
declare got text;
begin
  got := public.dg_receipt_text(
    '{"source":"ifood","display_number":"1783","customer":"Cliente de teste","items":[{"quantity":1,"name":"Açai 500 ml","modifiers":[{"name":"Morango","quantity":2},"Raspas de chocolate"]}],"total":32.5,"payment":"ONLINE"}'::jsonb
  );
  if pg_catalog.strpos(got,'2 x Morango')=0
     or pg_catalog.strpos(got,'1 x Raspas de chocolate')=0
     or pg_catalog.strpos(got,'Pedido: 1783')=0 then
    raise exception 'Falha na renderização de complementos do iFood';
  end if;
end;
$smoke$;

notify pgrst, 'reload schema';
