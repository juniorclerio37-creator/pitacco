-- Courier payout ledger: immutable payment history per store/courier.
begin;
create table if not exists public.pitacco_courier_payouts(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 amount numeric(12,2) not null check(amount>0),
 period_start date not null,
 period_end date not null,
 note text not null default '',
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid(),
 check(period_end>=period_start)
);
create index if not exists pitacco_courier_payouts_lookup on public.pitacco_courier_payouts(store_id,courier_id,created_at desc);
alter table public.pitacco_courier_payouts enable row level security;
drop policy if exists pitacco_courier_payouts_manager on public.pitacco_courier_payouts;
create policy pitacco_courier_payouts_manager on public.pitacco_courier_payouts
 for select to authenticated using(public.is_store_manager(store_id));
create or replace function public.pitacco_register_courier_payout(p_store uuid,p_courier uuid,p_start date,p_end date,p_amount numeric,p_note text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_due numeric;
begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_amount is null or p_amount<=0 then raise exception 'Pagamento invalido'; end if;
 if not exists(select 1 from public.couriers where id=p_courier and store_id=p_store) then raise exception 'Entregador nao pertence a loja'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store::text||p_courier::text,0));
 select coalesce(sum(d.courier_payment),0) into v_due from public.deliveries d
 where d.store_id=p_store and d.courier_id=p_courier and d.status='entregue'
 and (d.updated_at at time zone 'America/Sao_Paulo')::date between p_start and p_end;
 v_due:=v_due-(select coalesce(sum(amount),0) from public.pitacco_courier_payouts where store_id=p_store and courier_id=p_courier and period_start>=p_start and period_end<=p_end);
 if round(p_amount,2)>round(v_due,2) then raise exception 'Pagamento excede saldo do periodo'; end if;
 insert into public.pitacco_courier_payouts(store_id,courier_id,period_start,period_end,amount,note)
 values(p_store,p_courier,p_start,p_end,round(p_amount,2),left(coalesce(p_note,''),500)) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.pitacco_register_courier_payout(uuid,uuid,date,date,numeric,text) from public,anon;
grant execute on function public.pitacco_register_courier_payout(uuid,uuid,date,date,numeric,text) to authenticated;
commit;
