begin;
alter table public.products add column menu_active boolean not null default false;
alter table public.products add column category text not null default '';
alter table public.products add column description text not null default '';
alter table public.products add column image_url text not null default '';
-- Existing finance/product forms keep their permissions; publishing is manager-only.
revoke insert on public.products from authenticated;
grant insert(store_id,name,price,cost) on public.products to authenticated;
revoke all on public.products,public.orders,public.deliveries from anon;
create table public.public_menu_settings (
 store_id uuid primary key references public.stores(id),slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
 enabled boolean not null default false,delivery_enabled boolean not null default true,pickup_enabled boolean not null default true,
 delivery_fee numeric(10,2) not null default 0 check(delivery_fee between 0 and 1000),
 payment_methods text[] not null default array['dinheiro']::text[],pix_instructions text not null default '',
 check(delivery_enabled or pickup_enabled),check(cardinality(payment_methods) between 1 and 3 and payment_methods <@ array['dinheiro','cartao_entrega','pix_manual']::text[])
);
create table public.public_checkouts (
 order_id uuid primary key references public.orders(id),store_id uuid not null references public.stores(id),request_id uuid not null,
 tracking_token uuid not null unique default gen_random_uuid(),expires_at timestamptz not null default now()+interval '7 days',
 payload jsonb not null,phone text not null,payment_instructions text not null default '',created_at timestamptz not null default now(),unique(store_id,request_id)
);
create index public_checkout_rate on public.public_checkouts(store_id,created_at,phone);
create table public.manual_payments (
 order_id uuid primary key references public.orders(id),store_id uuid not null references public.stores(id),request_id uuid not null unique,
 amount numeric(12,2) not null check(amount>0),reference text not null,confirmed_by uuid not null references auth.users(id),confirmed_at timestamptz not null default now()
);
alter table public.public_menu_settings enable row level security;
alter table public.public_checkouts enable row level security;
alter table public.manual_payments enable row level security;
revoke all on public.public_menu_settings,public.public_checkouts,public.manual_payments from public,anon,authenticated;
grant select on public.public_menu_settings,public.manual_payments to authenticated;
create policy menu_manager_read on public.public_menu_settings for select to authenticated using(public.is_store_manager(store_id));
create policy payment_manager_read on public.manual_payments for select to authenticated using(public.is_store_manager(store_id));
create function public.save_public_menu_settings(p_store uuid,p_slug text,p_enabled boolean,p_delivery_enabled boolean,p_pickup_enabled boolean,p_delivery_fee numeric,p_payment_methods text[],p_pix_instructions text default '') returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,59}$' or p_enabled is null or p_delivery_enabled is null or p_pickup_enabled is null or not(p_delivery_enabled or p_pickup_enabled) or p_delivery_fee is null or p_delivery_fee<0 or p_delivery_fee>1000 or p_payment_methods is null or cardinality(p_payment_methods) not between 1 and 3 or not p_payment_methods <@ array['dinheiro','cartao_entrega','pix_manual']::text[] or array_position(p_payment_methods,null) is not null or (select count(distinct x) from unnest(p_payment_methods)x)<>cardinality(p_payment_methods) or length(coalesce(p_pix_instructions,''))>1000 or ('pix_manual'=any(p_payment_methods) and length(trim(coalesce(p_pix_instructions,'')))<3) then raise exception 'Configuracao invalida'; end if;
 insert into public.public_menu_settings values(p_store,p_slug,p_enabled,p_delivery_enabled,p_pickup_enabled,round(p_delivery_fee,2),p_payment_methods,public.dg_clean_text(p_pix_instructions))
 on conflict(store_id) do update set slug=excluded.slug,enabled=excluded.enabled,delivery_enabled=excluded.delivery_enabled,pickup_enabled=excluded.pickup_enabled,delivery_fee=excluded.delivery_fee,payment_methods=excluded.payment_methods,pix_instructions=excluded.pix_instructions;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'menu_settings_saved',jsonb_build_object('slug',p_slug));
end $$;
create function public.save_menu_product(p_store uuid,p_product uuid,p_name text,p_price numeric,p_category text,p_description text,p_image_url text,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$ declare pid uuid; begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_price is null or p_price<0 or p_price>100000 or length(coalesce(p_category,''))>80 or length(coalesce(p_description,''))>1000 or length(coalesce(p_image_url,''))>1000 or p_active is null or (coalesce(p_image_url,'')<>'' and p_image_url !~ '^https://[^[:space:]]+$') then raise exception 'Produto invalido'; end if;
 if p_product is null then
 insert into public.products(store_id,name,price,cost,menu_active,category,description,image_url) values(p_store,trim(p_name),round(p_price,2),0,p_active,coalesce(p_category,''),coalesce(p_description,''),coalesce(p_image_url,'')) returning id into pid;
 else
 update public.products set name=trim(p_name),price=round(p_price,2),menu_active=p_active,category=coalesce(p_category,''),description=coalesce(p_description,''),image_url=coalesce(p_image_url,'') where id=p_product and store_id=p_store returning id into pid;
 if pid is null then raise exception 'Produto inexistente nesta loja'; end if;
 end if;
 insert into public.operation_audit(store_id,actor,action,details) values(p_store,auth.uid(),'menu_product_saved',jsonb_build_object('product_id',pid));return pid;
end $$;
create function public.get_public_menu(p_slug text) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare cfg public.public_menu_settings%rowtype; items jsonb; begin
 select * into cfg from public.public_menu_settings where slug=p_slug and enabled;if not found then raise exception 'Cardapio indisponivel';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price,'category',p.category,'description',p.description,'image_url',p.image_url) order by p.category,p.name,p.id),'[]') into items from public.products p where p.store_id=cfg.store_id and p.menu_active;
 return jsonb_build_object('store',jsonb_build_object('name',(select name from public.stores where id=cfg.store_id),'slug',cfg.slug,'delivery_enabled',cfg.delivery_enabled,'pickup_enabled',cfg.pickup_enabled,'delivery_fee',cfg.delivery_fee,'payment_methods',cfg.payment_methods,'pix_instructions',cfg.pix_instructions),'products',items);
end $$;
create function public.checkout_public_order(p_slug text,p_request uuid,p_customer text,p_phone text,p_address text,p_items jsonb,p_fulfillment text,p_payment text,p_notes text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.public_menu_settings%rowtype; prior public.public_checkouts%rowtype; item jsonb; product public.products%rowtype; canonical jsonb; normalized jsonb; snapshot jsonb:='[]'; v_phone text; customer text; address text; notes text; quantity integer; subtotal numeric:=0; fee numeric; total numeric; oid uuid; token uuid; st text;
begin
 if p_request is null or p_customer is null or length(trim(p_customer)) not between 2 and 120 or p_phone is null or length(p_phone)>30 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') or p_payment is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Dados invalidos';end if;
 if jsonb_array_length(p_items) not between 1 and 30 or octet_length(p_items::text)>12000 then raise exception 'Carrinho invalido';end if;
 v_phone:=regexp_replace(p_phone,'[^0-9]','','g');if length(v_phone) not between 10 and 13 then raise exception 'Telefone invalido';end if;
 customer:=public.dg_clean_text(trim(p_customer));address:=public.dg_clean_text(trim(coalesce(p_address,'')));notes:=public.dg_clean_text(trim(coalesce(p_notes,'')));
 if p_fulfillment='delivery' and length(address)<5 then raise exception 'Informe o endereco';end if;
 for item in select value from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'object' or not item ?& array['product_id','quantity'] or (item-array['product_id','quantity'])<>'{}'::jsonb or jsonb_typeof(item->'product_id')<>'string' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity')!~ '^[0-9]+$' then raise exception 'Item invalido';end if;
 quantity:=(item->>'quantity')::integer;if quantity not between 1 and 20 then raise exception 'Quantidade invalida';end if;perform(item->>'product_id')::uuid;end loop;
 if(select count(distinct(value->>'product_id')::uuid) from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Produto repetido';end if;
 select jsonb_agg(jsonb_build_object('product_id',(value->>'product_id')::uuid,'quantity',(value->>'quantity')::integer) order by(value->>'product_id')::uuid) into normalized from jsonb_array_elements(p_items);
 canonical:=jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',normalized,'fulfillment',p_fulfillment,'payment',p_payment,'notes',notes);
 select * into cfg from public.public_menu_settings where slug=p_slug for update;if not found then raise exception 'Cardapio indisponivel';end if;
 select * into prior from public.public_checkouts where store_id=cfg.store_id and request_id=p_request;
 if found then
 if prior.payload<>canonical then raise exception 'Chave reutilizada com dados diferentes';end if;
 return(select jsonb_build_object('order_id',o.id,'tracking_token',prior.tracking_token,'total',o.gross,'status',o.status,'payment_status',case when exists(select 1 from public.manual_payments where order_id=o.id) then 'paid_manual' else 'pending' end,'payment_instructions',prior.payment_instructions) from public.orders o where o.id=prior.order_id);end if;
 if not cfg.enabled or (p_fulfillment='delivery' and not cfg.delivery_enabled) or (p_fulfillment='pickup' and not cfg.pickup_enabled) or not p_payment=any(cfg.payment_methods) then raise exception 'Modalidade indisponivel';end if;
 if exists(select 1 from public.orders where store_id=cfg.store_id and request_id=p_request) then raise exception 'Chave indisponivel';end if;
 if(select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.created_at>now()-interval '1 minute')>=100 or (select count(*) from public.public_checkouts c where c.store_id=cfg.store_id and c.phone=v_phone and c.created_at>now()-interval '15 minutes')>=5 then raise exception 'Limite temporario de pedidos';end if;
 for item in select value from jsonb_array_elements(normalized) loop
 select * into product from public.products where id=(item->>'product_id')::uuid and store_id=cfg.store_id and menu_active for share;if not found then raise exception 'Produto indisponivel';end if;
 quantity:=(item->>'quantity')::integer;subtotal:=subtotal+product.price*quantity;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('name',public.dg_clean_text(product.name),'quantity',quantity,'unit_price',product.price,'modifiers','[]'::jsonb));end loop;
 fee:=case when p_fulfillment='delivery' then cfg.delivery_fee else 0 end;total:=subtotal+fee;if total<=0 or total>10000 then raise exception 'Valor fora do limite';end if;
 insert into public.orders(store_id,channel,gross,source,status,request_id,receipt) values(cfg.store_id,'Delivery próprio',total,'proprio','pending',p_request,jsonb_build_object('customer',customer,'phone',v_phone,'address',address,'items',snapshot,'subtotal',subtotal,'delivery_fee',fee,'total',total,'discount',0,'notes',notes,'payment',p_payment,'payment_status','pending','logistics',case when p_fulfillment='delivery' then 'loja' else 'retirada' end)) returning id into oid;
 insert into public.public_checkouts(order_id,store_id,request_id,payload,phone,payment_instructions) values(oid,cfg.store_id,p_request,canonical,v_phone,case when p_payment='pix_manual' then cfg.pix_instructions else '' end) returning tracking_token into token;
 insert into public.operation_audit(store_id,order_id,actor,action) values(cfg.store_id,oid,auth.uid(),'public_checkout_created');
 if exists(select 1 from public.acceptance_settings where store_id=cfg.store_id and source='proprio' and mode='automatic' and enabled) then perform public.dg_accept_own(oid);end if;
 select status into st from public.orders where id=oid;
 return jsonb_build_object('order_id',oid,'tracking_token',token,'total',total,'status',st,'payment_status','pending','payment_instructions',case when p_payment='pix_manual' then cfg.pix_instructions else '' end);
end $$;
create function public.track_public_order(p_token uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('order_number',o.id,'status',o.status,'delivery_status',d.status,'total',o.gross,'payment_status',case when m.order_id is null then 'pending' else 'paid_manual' end,'created_at',o.created_at,'payment_instructions',c.payment_instructions)
 from public.public_checkouts c join public.orders o on o.id=c.order_id left join public.deliveries d on d.order_id=o.id left join public.manual_payments m on m.order_id=o.id where c.tracking_token=p_token and c.expires_at>now()
$$;
create function public.confirm_manual_payment(p_order uuid,p_request uuid,p_amount numeric,p_reference text) returns void language plpgsql security definer set search_path='' as $$ declare o public.orders%rowtype;m public.manual_payments%rowtype;begin
 select * into o from public.orders where id=p_order for update;if not found or not public.is_store_manager(o.store_id) then raise exception 'Sem permissao';end if;
 if o.source<>'proprio' or o.status not in ('pending','accepted') or coalesce(o.receipt->>'payment','') not in ('dinheiro','cartao_entrega','pix_manual','pix','cartao') or p_request is null or p_amount is null or p_amount<>o.gross or length(trim(coalesce(p_reference,''))) not between 5 and 300 then raise exception 'Confira valor integral e referencia';end if;
 select * into m from public.manual_payments where order_id=o.id;if found then
 if m.request_id=p_request and m.amount=p_amount and m.reference=public.dg_clean_text(trim(p_reference)) then return;end if;raise exception 'Pagamento ja registrado';end if;
 insert into public.manual_payments values(o.id,o.store_id,p_request,p_amount,public.dg_clean_text(trim(p_reference)),auth.uid(),now());
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(o.store_id,o.id,auth.uid(),'manual_payment_confirmed',jsonb_build_object('amount',p_amount,'reference',public.dg_clean_text(p_reference)));
end $$;
-- Carry delivery fee into the courier record without changing existing dispatch rules.
create function public.dg_copy_checkout_fee() returns trigger language plpgsql set search_path='' as $$ begin
 if new.order_id is not null then new.delivery_fee:=coalesce((select (receipt->>'delivery_fee')::numeric from public.orders where id=new.order_id),new.delivery_fee);end if;return new;end $$;
create trigger checkout_delivery_fee before insert on public.deliveries for each row execute function public.dg_copy_checkout_fee();
revoke all on function public.save_public_menu_settings(uuid,text,boolean,boolean,boolean,numeric,text[],text),public.save_menu_product(uuid,uuid,text,numeric,text,text,text,boolean),public.get_public_menu(text),public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text),public.track_public_order(uuid),public.confirm_manual_payment(uuid,uuid,numeric,text),public.dg_copy_checkout_fee() from public,anon,authenticated;
grant execute on function public.save_public_menu_settings(uuid,text,boolean,boolean,boolean,numeric,text[],text),public.save_menu_product(uuid,uuid,text,numeric,text,text,text,boolean),public.confirm_manual_payment(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.get_public_menu(text),public.checkout_public_order(text,uuid,text,text,text,jsonb,text,text,text),public.track_public_order(uuid) to anon,authenticated;
commit;
