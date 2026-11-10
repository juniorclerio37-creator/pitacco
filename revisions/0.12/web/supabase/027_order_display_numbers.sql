-- Stable public order numbers; internal UUID remains unchanged.
begin;
create table if not exists public.pitacco_order_sequences(
 store_id uuid not null references public.stores(id) on delete cascade,
 prefix text not null check(prefix in ('D','B')),
 last_number bigint not null default 1000,
 primary key(store_id,prefix)
);
alter table public.pitacco_order_sequences enable row level security;
revoke all on public.pitacco_order_sequences from public,anon,authenticated;
create or replace function public.pitacco_assign_order_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare pref text; seq bigint; external_no text;
begin
 if new.source in ('ifood','99food','keeta') then
  external_no:=nullif(trim(coalesce(new.receipt->>'external_order_number',new.receipt->>'order_number',new.receipt->>'display_id',new.receipt->>'number','')),'');
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
end $$;
drop trigger if exists pitacco_order_number_before_insert on public.orders;
create trigger pitacco_order_number_before_insert
 before insert on public.orders for each row execute function public.pitacco_assign_order_number();
revoke all on function public.pitacco_assign_order_number() from public,anon,authenticated;
-- Existing orders retain their recorded marketplace number; do not fabricate one.
-- Counter-sales RPC is exclusively used by the in-store new-sale form.
create or replace function public.create_operational_order(p_store uuid,p_request uuid,p_customer text,p_address text,p_items jsonb,p_total numeric,p_notes text default '',p_payment text default 'dinheiro',p_logistics text default 'loja')
returns uuid language plpgsql security definer set search_path='' as $$
declare oid uuid; item jsonb; clean_items jsonb:='[]'; mods jsonb; total numeric:=0; q numeric; price numeric;
begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_request is null or nullif(trim(coalesce(p_customer,'')),'') is null or p_logistics not in ('loja','retirada') or
 (p_logistics='loja' and nullif(trim(coalesce(p_address,'')),'') is null) or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos'; end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Quantidade de itens invalida'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||p_request::text,0));
 select id into oid from public.orders where store_id=p_store and request_id=p_request;
 if oid is not null then return oid; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  q:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric;
  if q is null or q<1 or q>1000 or q<>trunc(q) or price is null or price<0 or price>100000 or nullif(trim(coalesce(item->>'name','')),'') is null then raise exception 'Item invalido'; end if;
  if jsonb_typeof(coalesce(item->'modifiers','[]'::jsonb))<>'array' then raise exception 'Complementos invalidos'; end if;
  if jsonb_array_length(coalesce(item->'modifiers','[]'::jsonb))>50 or exists(select 1 from jsonb_array_elements(coalesce(item->'modifiers','[]'::jsonb)) x where jsonb_typeof(x)<>'string') then raise exception 'Complementos devem ser textos, no maximo 50'; end if;
  select coalesce(jsonb_agg(public.dg_clean_text(value #>> '{}')),'[]'::jsonb) into mods from jsonb_array_elements(coalesce(item->'modifiers','[]'::jsonb));
  clean_items:=clean_items||jsonb_build_array(jsonb_build_object('name',public.dg_clean_text(item->>'name'),'quantity',q,'unit_price',round(price,2),'modifiers',mods));
  total:=total+q*round(price,2);
 end loop;
 if p_total is null or round(p_total,2)<>total then raise exception 'Total diferente da soma dos itens'; end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt)
 values(p_store,'Balcao',total,'proprio','pending',p_request,
 jsonb_build_object('sales_channel','balcao','customer',public.dg_clean_text(p_customer),'address',public.dg_clean_text(p_address),'items',clean_items,'total',total,'notes',public.dg_clean_text(p_notes),'payment',public.dg_clean_text(p_payment),'payment_status','nao confirmado','logistics',p_logistics)) returning id into oid;
 if exists(select 1 from public.acceptance_settings where store_id=p_store and source='proprio' and mode='automatic' and enabled) then perform public.dg_accept_own(oid); end if;
 return oid;
end $$;
commit;
