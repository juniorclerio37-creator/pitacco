begin;
create table if not exists public.pitacco_order_costs(
 order_id uuid primary key references public.orders(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 merchant_discount numeric(12,2) check(merchant_discount>=0),
 processing_fees numeric(12,2) check(processing_fees>=0),
 delivery_cost numeric(12,2) check(delivery_cost>=0),
 goods_cost numeric(12,2) check(goods_cost>=0),
 other_cost numeric(12,2) check(other_cost>=0),
 updated_at timestamptz not null default now()
);
create or replace function public.pitacco_order_costs_validate()
returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.orders where id=new.order_id and store_id=new.store_id) then raise exception 'Pedido nao pertence a loja';end if;
 new.updated_at=now();return new;
end $$;
drop trigger if exists pitacco_order_costs_validate on public.pitacco_order_costs;
create trigger pitacco_order_costs_validate before insert or update on public.pitacco_order_costs for each row execute function public.pitacco_order_costs_validate();
alter table public.pitacco_order_costs enable row level security;
drop policy if exists pitacco_order_costs_manager on public.pitacco_order_costs;
create policy pitacco_order_costs_manager on public.pitacco_order_costs for all to authenticated using(public.is_store_manager(store_id)) with check(public.is_store_manager(store_id));
commit;