-- Enrollment is explicit. Existing stores and the monthly subscription flow are untouched.
create table pitacco_private.commission_enrollments (
 store_id uuid primary key references public.stores(id),
 starts_at timestamptz not null,
 ends_at timestamptz,
 check (ends_at is null or ends_at>starts_at)
);
create table pitacco_private.commission_orders (
 order_id uuid primary key references public.orders(id),
 store_id uuid not null references pitacco_private.commission_enrollments(store_id),
 product_cents bigint not null check (product_cents>=0),
 discount_cents bigint not null check (discount_cents between 0 and product_cents),
 delivery_cents bigint not null check (delivery_cents>=0),
 completed_at timestamptz,
 unique (store_id,order_id)
);
create index commission_orders_store_completed on pitacco_private.commission_orders (store_id,completed_at);
create table pitacco_private.weekly_invoices (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references pitacco_private.commission_enrollments(store_id),
 week_start date not null,
 due_at timestamptz not null,
 grace_until timestamptz not null,
 closed_at timestamptz not null default clock_timestamp(),
 plan_code text not null default 'free' check (plan_code='free'),
 commission_basis_points integer not null default 500 check (commission_basis_points=500),
 order_count integer not null check (order_count>=0),
 product_cents bigint not null check (product_cents>=0),
 discount_cents bigint not null check (discount_cents>=0),
 delivery_cents bigint not null check (delivery_cents>=0),
 base_cents bigint not null check (base_cents>=0),
 amount_cents bigint not null check (amount_cents>=0),
 unique (store_id,week_start),
 unique (store_id,id)
);
create table pitacco_private.weekly_invoice_orders (
 invoice_id uuid not null,
 store_id uuid not null,
 order_id uuid primary key,
 eligible_at timestamptz not null,
 product_cents bigint not null,
 discount_cents bigint not null,
 delivery_cents bigint not null,
 base_cents bigint not null,
 foreign key (store_id,invoice_id) references pitacco_private.weekly_invoices(store_id,id),
 foreign key (store_id,order_id) references pitacco_private.commission_orders(store_id,order_id)
);
create index weekly_invoice_orders_invoice on pitacco_private.weekly_invoice_orders (store_id,invoice_id);

alter table pitacco_private.commission_enrollments enable row level security;
alter table pitacco_private.commission_orders enable row level security;
alter table pitacco_private.weekly_invoices enable row level security;
alter table pitacco_private.weekly_invoice_orders enable row level security;
revoke all on pitacco_private.commission_enrollments,pitacco_private.commission_orders,
 pitacco_private.weekly_invoices,pitacco_private.weekly_invoice_orders from public,anon,authenticated,service_role;

-- Capture the product amount from validated checkout before later order updates.
create function pitacco_private.capture_commission_checkout()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 r jsonb;
 gross numeric;
 products numeric;
 discount numeric;
 delivery numeric;
begin
 select o.receipt,o.gross into r,gross
 from pitacco_private.commission_enrollments a
 join public.orders o on o.store_id=a.store_id
 where a.store_id=new.store_id and o.id=new.order_id and o.request_id=new.request_id
   and o.source='proprio' and new.created_at>=a.starts_at
   and (a.ends_at is null or new.created_at<a.ends_at);
 if not found or r is null or coalesce(r->>'is_test','false')<>'false' or coalesce(r->>'test','false')<>'false'
   or jsonb_typeof(r->'subtotal') is distinct from 'number'
   or jsonb_typeof(r->'discount') is distinct from 'number'
   or jsonb_typeof(r->'delivery_fee') is distinct from 'number' then
  return new;
 end if;
 products:=(r->>'subtotal')::numeric;
 discount:=(r->>'discount')::numeric;
 delivery:=(r->>'delivery_fee')::numeric;
 if products not between 0 and 10000 or discount not between 0 and products or delivery not between 0 and 10000
   or products-discount+delivery<>gross
   or products<>round(products,2) or discount<>round(discount,2) or delivery<>round(delivery,2) then
  return new;
 end if;
 insert into pitacco_private.commission_orders(order_id,store_id,product_cents,discount_cents,delivery_cents)
 values(new.order_id,new.store_id,products*100,discount*100,delivery*100)
 on conflict(order_id) do nothing;
 return new;
end $$;
revoke all on function pitacco_private.capture_commission_checkout() from public,anon,authenticated,service_role;
create trigger pitacco_capture_commission_checkout after insert on public.public_checkouts
 for each row execute function pitacco_private.capture_commission_checkout();

create function pitacco_private.capture_commission_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare finished_id uuid;
begin
 if tg_table_name='orders' then finished_id:=new.id;
 else finished_id:=new.order_id;
 end if;
 update pitacco_private.commission_orders set completed_at=clock_timestamp()
 where order_id=finished_id and store_id=new.store_id and completed_at is null;
 return new;
end $$;
revoke all on function pitacco_private.capture_commission_completion() from public,anon,authenticated,service_role;
create trigger pitacco_commission_pickup_completed after update of preparation_status on public.orders
 for each row when (new.preparation_status='completed' and old.preparation_status is distinct from new.preparation_status
  and new.receipt->>'logistics'='retirada')
 execute function pitacco_private.capture_commission_completion();
create trigger pitacco_commission_delivery_completed after insert or update of status on public.deliveries
 for each row when (new.status='entregue' and new.order_id is not null)
 execute function pitacco_private.capture_commission_completion();

-- This entry point is internal. Closing a week records amounts without calling a payment provider.
create function pitacco_private.close_commission_week(p_store uuid,p_week date)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 period record;
 active_since timestamptz;
 invoice uuid;
begin
 if p_store is null or p_week is null or extract(isodow from p_week)<>3 then
  raise exception 'Informe uma loja e a quarta-feira de início da semana' using errcode='22023';
 end if;
 select * into period from pitacco_private.weekly_commission_period(p_week::timestamp at time zone 'America/Sao_Paulo');
 if clock_timestamp()<period.period_end then
  raise exception 'A semana de apuração continua aberta' using errcode='22023';
 end if;
 select starts_at into active_since from pitacco_private.commission_enrollments where store_id=p_store for update;
 if not found or active_since>=period.period_end then return null; end if;
 select id into invoice from pitacco_private.weekly_invoices where store_id=p_store and week_start=p_week;
 if found then return invoice; end if;
 if exists(select 1 from pitacco_private.weekly_invoices where store_id=p_store and week_start>p_week) then
  raise exception 'Já existe um fechamento de semana posterior' using errcode='22023';
 end if;

 with eligible as materialized (
  select c.order_id,c.product_cents,c.discount_cents,c.delivery_cents,
   greatest(c.completed_at,m.confirmed_at) as eligible_at,
   pitacco_private.weekly_commission_base(o.source,true,false,false,c.product_cents,c.discount_cents,0,0) as base_cents
  from pitacco_private.commission_orders c
  join public.orders o on o.id=c.order_id and o.store_id=c.store_id
  join public.manual_payments m on m.order_id=c.order_id and m.store_id=c.store_id
  where c.store_id=p_store and c.completed_at<period.period_end and m.confirmed_at<period.period_end
    and o.status='accepted' and o.source='proprio'
    and m.amount*100=c.product_cents-c.discount_cents+c.delivery_cents
    and not exists (select 1 from public.deliveries d where d.order_id=c.order_id and d.store_id=c.store_id and d.status='cancelada')
    and not exists (select 1 from pitacco_private.weekly_invoice_orders l where l.order_id=c.order_id)
 ), header as (
  insert into pitacco_private.weekly_invoices(store_id,week_start,due_at,grace_until,order_count,
   product_cents,discount_cents,delivery_cents,base_cents,amount_cents)
  select p_store,p_week,period.due_at,period.grace_until,count(*),
    coalesce(sum(product_cents),0),coalesce(sum(discount_cents),0),coalesce(sum(delivery_cents),0),
    coalesce(sum(base_cents),0),pitacco_private.weekly_commission_cents(coalesce(sum(base_cents),0))
  from eligible
  returning id
 ), lines as (
  insert into pitacco_private.weekly_invoice_orders(invoice_id,store_id,order_id,eligible_at,
    product_cents,discount_cents,delivery_cents,base_cents)
  select h.id,p_store,e.order_id,e.eligible_at,e.product_cents,e.discount_cents,e.delivery_cents,e.base_cents
  from header h cross join eligible e
 )
 select h.id into invoice from header h;
 return invoice;
end $$;
revoke all on function pitacco_private.close_commission_week(uuid,date) from public,anon,authenticated,service_role;
