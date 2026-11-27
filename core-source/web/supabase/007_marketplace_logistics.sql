-- Execute after 003, 004, 005 and 006. A marketplace order may be delivered
-- by the platform's own courier: it must NEVER enter the store courier queue.
-- 'source' (005) identifies where the order was placed; logistics_provider
-- identifies who performs the last-mile delivery. They are independent.
alter table public.deliveries add column if not exists logistics_provider text not null default 'loja'
  check (logistics_provider in ('loja','marketplace'));
alter table public.deliveries add column if not exists external_order_id text;
alter table public.deliveries add column if not exists external_delivery_status text;
create unique index if not exists deliveries_external_order_unique
 on public.deliveries(store_id,source,external_order_id) where external_order_id is not null;
create index if not exists deliveries_dispatch_eligible_idx
 on public.deliveries(store_id,status) where logistics_provider='loja';
-- Forbid marketplace courier assignment even if a caller invokes an older RPC.
create or replace function public.guard_marketplace_logistics() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.logistics_provider='marketplace' then
   if new.source not in ('ifood','99food','keeta') then
     raise exception 'Entrega parceira exige origem marketplace';
   end if;
   if new.courier_id is not null or new.batch_id is not null or
      new.status in ('atribuida','aceita','retirada') then
     raise exception 'Entrega parceira não pode ser atribuída a entregador próprio';
   end if;
   if tg_op='UPDATE' and old.logistics_provider='loja' and
      old.status not in ('pendente','cancelada') then
     raise exception 'Não altere o operador logístico de entrega em andamento';
   end if;
 end if;
 if tg_op='UPDATE' and old.logistics_provider='marketplace' and
    new.logistics_provider='loja' then
   raise exception 'Alteração de operador exige fluxo autorizado de migração';
 end if;
 return new;
end$$;
drop trigger if exists deliveries_marketplace_guard on public.deliveries;
create trigger deliveries_marketplace_guard before insert or update on public.deliveries
 for each row execute function public.guard_marketplace_logistics();
-- Ingestion from authenticated manager is for MANUAL TEST ENTRY only;
-- official marketplace synchronization must use a separate verified server integration.
create or replace function public.register_marketplace_partner_delivery(
 s uuid, marketplace text, external_ref text, customer text, destination text,
 details text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 if marketplace not in ('ifood','99food','keeta') then raise exception 'Origem inválida'; end if;
 if length(trim(coalesce(external_ref,'')))<1 or length(trim(coalesce(customer,'')))<1
    or length(trim(coalesce(destination,'')))<1 then raise exception 'Dados obrigatórios'; end if;
 insert into public.deliveries(store_id,source,logistics_provider,external_order_id,
  customer_name,address,notes,delivery_fee,courier_payment,status)
 values(s,marketplace,'marketplace',trim(external_ref),trim(customer),trim(destination),
  coalesce(details,''),0,0,'pendente') returning id into did;
 return did;
end$$;
revoke all on function public.register_marketplace_partner_delivery(uuid,text,text,text,text,text) from public;
grant execute on function public.register_marketplace_partner_delivery(uuid,text,text,text,text,text) to authenticated;
-- Auto-dispatch from 004 is replaced to ignore partner deliveries.
create or replace function public.dispatch_delivery_on_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare chosen uuid;
begin
 if new.logistics_provider <> 'loja' or
    (select dispatch_mode from public.stores where id=new.store_id) <> 'automatica'
 then return new; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.store_id::text,0));
 select c.id into chosen from public.couriers c where c.active and c.available and
 ((c.fleet_type='propria' and c.store_id=new.store_id and
   (select delivery_mode from public.stores where id=new.store_id) in ('propria','ambas'))
 or (c.fleet_type='compartilhada' and
   (select delivery_mode from public.stores where id=new.store_id) in ('compartilhada','ambas')))
 order by (select count(*) from public.deliveries d where d.courier_id=c.id
   and d.status in ('atribuida','aceita','retirada')),c.created_at,c.id limit 1;
 if chosen is not null then
  update public.deliveries set courier_id=chosen,status='atribuida',updated_at=now() where id=new.id;
 end if;
 return new;
end$$;
-- Explicitly block dispatch in RPCs; guard trigger is defense in depth.
create or replace function public.assign_delivery_batch(s uuid,courier uuid,delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; n integer; fleet text; mode text;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 n:=coalesce(array_length(delivery_ids,1),0);
 if n<2 or n>15 or (select count(distinct x) from unnest(delivery_ids) x)<>n
 then raise exception 'Selecione de 2 a 15 entregas distintas'; end if;
 select delivery_mode into mode from public.stores where id=s;
 select fleet_type into fleet from public.couriers where id=courier and active;
 if fleet is null or not public.can_manage_courier(courier,s) or
 (fleet='propria' and mode not in ('propria','ambas')) or
 (fleet='compartilhada' and mode not in ('compartilhada','ambas'))
 then raise exception 'Entregador não autorizado'; end if;
 perform 1 from public.deliveries where id=any(delivery_ids) for update;
 if (select count(*) from public.deliveries where id=any(delivery_ids)
   and store_id=s and logistics_provider='loja' and
   status in ('pendente','atribuida') and batch_id is null)<>n
 then raise exception 'O lote contém entrega parceira ou indisponível'; end if;
 insert into public.delivery_batches(store_id,courier_id,created_by)
 values(s,courier,(select auth.uid())) returning id into batch;
 update public.deliveries set courier_id=courier,status='atribuida',batch_id=batch,updated_at=now()
 where id=any(delivery_ids);
 return batch;
end$$;
-- Existing assign_delivery RPC is protected by guard trigger as well.
-- Partner status is intentionally read-only until official authenticated webhook
-- ingestion is implemented, with signature verification, idempotency and mapping.
