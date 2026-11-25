create table pitacco_private.customer_device_orders(
 store_id uuid not null, device_hash text not null, order_id uuid not null references public.orders(id) on delete cascade,
 linked_at timestamptz not null default now(), primary key(store_id,device_hash,order_id),
 foreign key(store_id,device_hash) references pitacco_private.customer_device_sessions(store_id,device_hash) on delete cascade
);
alter table pitacco_private.customer_device_orders enable row level security;
revoke all on pitacco_private.customer_device_orders from public,anon,authenticated;
create function public.pitacco_customer_device_orders(p_slug text,p_device text,p_action text default 'list',p_tracking uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; digest text; s pitacco_private.customer_device_sessions%rowtype; oid uuid;
begin
 if coalesce(p_device,'') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then return jsonb_build_object('active',false);end if;
 select store_id into sid from public.public_menu_settings where slug=p_slug and enabled;
 if sid is null then return jsonb_build_object('active',false);end if;
 digest:=encode(sha256(convert_to(p_device,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(sid::text||digest,0));
 select * into s from pitacco_private.customer_device_sessions where store_id=sid and device_hash=digest and revoked_at is null and expires_at>now();
 if not found then return jsonb_build_object('active',false);end if;
 if p_action='link' then
  select c.order_id into oid from public.public_checkouts c join public.orders o on o.id=c.order_id and o.store_id=c.store_id
  where c.store_id=sid and c.tracking_token=p_tracking and c.expires_at>now() and o.source='proprio'
  and regexp_replace(coalesce(c.phone,c.payload->>'phone',''),'[^0-9]','','g') in (s.phone,'55'||s.phone);
  if oid is null then return jsonb_build_object('active',true,'linked',false);end if;
  insert into pitacco_private.customer_device_orders(store_id,device_hash,order_id) values(sid,digest,oid) on conflict do nothing;
  return jsonb_build_object('active',true,'linked',true);
 elsif p_action='list' then
  return jsonb_build_object('active',true,'orders',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (
   select o.id,public.pitacco_order_public_label(o.receipt,o.source) as number,o.created_at,o.status,o.gross as total,
   case when c.expires_at>now() then c.tracking_token else null end as tracking_token,
   coalesce((select jsonb_agg(jsonb_build_object('name',left(i->>'name',160),'quantity',i->'quantity')) from jsonb_array_elements(case when jsonb_typeof(o.receipt->'items')='array' then o.receipt->'items' else '[]'::jsonb end) i),'[]'::jsonb) as summary,
   coalesce((select jsonb_agg(jsonb_build_object('product_id',i->'product_id','quantity',i->'quantity','options',i->'options')) from jsonb_array_elements(case when jsonb_typeof(c.payload->'items')='array' then c.payload->'items' else '[]'::jsonb end) i),'[]'::jsonb) as items
   from pitacco_private.customer_device_orders l join public.orders o on o.id=l.order_id and o.store_id=l.store_id
   join public.public_checkouts c on c.order_id=o.id and c.store_id=o.store_id
   where l.store_id=sid and l.device_hash=digest order by o.created_at desc limit 50
  ) h),'[]'::jsonb));
 end if;
 return jsonb_build_object('active',true,'error','Ação inválida');
end $$;
revoke all on function public.pitacco_customer_device_orders(text,text,text,uuid) from public;
grant execute on function public.pitacco_customer_device_orders(text,text,text,uuid) to anon,authenticated;;
