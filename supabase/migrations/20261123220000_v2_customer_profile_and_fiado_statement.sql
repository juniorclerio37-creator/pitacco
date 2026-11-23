-- Template V2 customer profile stored per store and telephone, gated by a
-- high-entropy per-device credential. Never disclose private customer profiles
-- merely because a phone number matches. Other templates are unaffected.
create table if not exists public.pitacco_v2_customer_profiles(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 phone text not null check(phone ~ '^[0-9]{10,11}$'),
 device_hash text not null check(length(device_hash)=64),
 name text not null check(length(name) between 2 and 120),
 addresses jsonb not null default '[]'::jsonb check(jsonb_typeof(addresses)='array' and jsonb_array_length(addresses)<=8),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(store_id,phone,device_hash)
);
create index if not exists pitacco_v2_profiles_store_phone_idx
 on public.pitacco_v2_customer_profiles(store_id,phone);
alter table public.pitacco_v2_customer_profiles enable row level security;
revoke all on public.pitacco_v2_customer_profiles from public,anon,authenticated;

create or replace function public.pitacco_v2_customer_profile(
 p_slug text,p_phone text,p_device text,p_action text default 'load',
 p_name text default null,p_addresses jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $v2$
declare sid uuid; normalized text; digest text; customer public.pitacco_v2_customer_profiles%rowtype;
 clean_addresses jsonb:='[]'::jsonb; address_item jsonb; label text;
 v_street text;v_number text;v_neighborhood text;v_city text;v_state text;v_postal text;v_extra text;
 v_name text;
begin
 normalized:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if left(normalized,2)='55' and length(normalized) in (12,13) then normalized:=substr(normalized,3);end if;
 if normalized !~ '^[0-9]{10,11}$' or coalesce(p_device,'') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
 then return jsonb_build_object('found',false,'error','Identificação inválida');end if;
 select m.store_id into sid from public.public_menu_settings m where m.slug=p_slug and m.enabled limit 1;
 if sid is null then return jsonb_build_object('found',false,'error','Cardápio indisponível');end if;
 digest:=encode(sha256(convert_to(p_device,'UTF8')),'hex');
 select * into customer from public.pitacco_v2_customer_profiles
 where store_id=sid and phone=normalized and device_hash=digest for update;
 if p_action='load' then
  if not found then return jsonb_build_object('found',false,'addresses','[]'::jsonb);end if;
  return jsonb_build_object('found',true,'name',customer.name,'addresses',customer.addresses);
 end if;
 if p_action<>'save' then return jsonb_build_object('error','Ação inválida');end if;
 v_name:=btrim(coalesce(p_name,''));
 if length(v_name) not between 2 and 120 then return jsonb_build_object('error','Nome inválido');end if;
 if p_addresses is null then
  clean_addresses:=case when found then customer.addresses else '[]'::jsonb end;
 else
  if jsonb_typeof(p_addresses)<>'array' or jsonb_array_length(p_addresses)>8 then
   return jsonb_build_object('error','Endereços inválidos');end if;
  for address_item in select value from jsonb_array_elements(p_addresses) loop
   if jsonb_typeof(address_item)<>'object' then return jsonb_build_object('error','Endereço inválido');end if;
   label:=left(btrim(coalesce(address_item->>'label','Casa')),24);
   v_street:=left(btrim(coalesce(address_item->>'street','')),100);
   v_number:=left(btrim(coalesce(address_item->>'number','')),20);
   v_neighborhood:=left(btrim(coalesce(address_item->>'neighborhood','')),60);
   v_city:=left(btrim(coalesce(address_item->>'city','')),60);
   v_state:=upper(btrim(coalesce(address_item->>'state','')));
   v_postal:=regexp_replace(coalesce(address_item->>'postal',''),'[^0-9]','','g');
   v_extra:=left(btrim(coalesce(address_item->>'extra','')),100);
   if length(v_street)<3 or length(v_number)<1 or length(v_neighborhood)<2
    or length(v_city)<2 or v_state !~ '^[A-Z]{2}$' or length(v_postal) not in (0,8)
   then return jsonb_build_object('error','Preencha o endereço completo');end if;
   clean_addresses:=clean_addresses||jsonb_build_array(jsonb_build_object(
    'id',case when coalesce(address_item->>'id','') ~ '^[0-9a-f-]{36}$' then address_item->>'id' else gen_random_uuid()::text end,
    'label',case when label='' then 'Casa' else label end,
    'street',v_street,'number',v_number,'neighborhood',v_neighborhood,
    'city',v_city,'state',v_state,'postal',v_postal,'extra',v_extra,
    'is_default',coalesce((address_item->>'is_default')::boolean,false)
   ));
  end loop;
 end if;
 insert into public.pitacco_v2_customer_profiles(store_id,phone,device_hash,name,addresses)
 values(sid,normalized,digest,v_name,clean_addresses)
 on conflict(store_id,phone,device_hash)
 do update set name=excluded.name,addresses=excluded.addresses,updated_at=now()
 returning * into customer;
 return jsonb_build_object('found',true,'name',customer.name,'addresses',customer.addresses);
end $v2$;
revoke all on function public.pitacco_v2_customer_profile(text,text,text,text,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.pitacco_v2_customer_profile(text,text,text,text,text,jsonb)
 to anon,authenticated;

-- PIN must first be verified by the existing, rate-limited Fiado validator.
-- This function consumes a five-minute single-use PIN verification token.
-- It returns open charges and payment history ONLY, not credit ceiling/available.
create or replace function public.pitacco_v2_fiado_statement(p_slug text,p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $v2$
declare sid uuid; verification pitacco_private.fiado_pin_verifications%rowtype;
 charges jsonb; payments jsonb; outstanding numeric; due_date timestamptz;
 instructions text;
begin
 select m.store_id,m.pix_instructions into sid,instructions
 from public.public_menu_settings m where m.slug=p_slug and m.enabled limit 1;
 if sid is null or p_token is null then return jsonb_build_object('error','Verificação necessária');end if;
 select * into verification from pitacco_private.fiado_pin_verifications
  where token=p_token and store_id=sid and used_at is null and expires_at>now() for update;
 if not found then return jsonb_build_object('error','Verificação vencida ou já utilizada');end if;
 update pitacco_private.fiado_pin_verifications set used_at=now() where token=p_token;
 select
  coalesce(jsonb_agg(jsonb_build_object(
   'order_id',c.order_id,'date',c.created_at,'due',c.due_at,
   'amount',c.amount,'paid',c.paid,'outstanding',greatest(0,c.amount-c.paid),
   'state',c.state,'description',
   coalesce((select string_agg(left(x.value->>'name',80),', ')
     from jsonb_array_elements(case when jsonb_typeof(o.receipt->'items')='array'
     then o.receipt->'items' else '[]'::jsonb end) x(value)), 'Pedido')
  ) order by c.created_at desc),'[]'::jsonb),
  coalesce(sum(greatest(0,c.amount-c.paid)) filter(where c.state not in ('cancelled','rejected')) ,0),
  min(c.due_at) filter(where c.state not in ('cancelled','rejected') and c.amount>c.paid)
 into charges,outstanding,due_date
 from public.pitacco_fiado_charges c
 left join public.orders o on o.id=c.order_id and o.store_id=c.store_id
 where c.store_id=sid and c.customer_id=verification.customer_id;
 select coalesce(jsonb_agg(jsonb_build_object(
  'date',p.created_at,'amount',p.amount,'method',p.method
 ) order by p.created_at desc),'[]'::jsonb) into payments
 from public.pitacco_fiado_payments p
 where p.store_id=sid and p.customer_id=verification.customer_id;
 return jsonb_build_object('outstanding',outstanding,'next_due',due_date,
  'charges',charges,'payments',payments,
  'pix_instructions',case when instructions is not null and btrim(instructions)<>'' then instructions else null end);
end $v2$;
revoke all on function public.pitacco_v2_fiado_statement(text,uuid) from public,anon,authenticated;
grant execute on function public.pitacco_v2_fiado_statement(text,uuid) to anon,authenticated;
