-- Run after schema.sql, 003_delivery.sql and (if using driver app) 004/005.
create table if not exists public.delivery_batches (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 courier_id uuid not null references public.couriers(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.deliveries add column if not exists batch_id uuid references public.delivery_batches(id);
create index if not exists deliveries_batch_idx on public.deliveries(batch_id);
alter table public.delivery_batches enable row level security;
create policy batches_read on public.delivery_batches for select to authenticated
 using (public.can_access_store(store_id) or public.is_courier(courier_id));
-- Atomic multi-order assignment. Shared couriers: admin only, matching existing authorization rules.
create or replace function public.assign_delivery_batch(s uuid, courier uuid, delivery_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid; expected_count integer; matching_count integer; fleet text; mode text;
begin
 if not public.is_store_manager(s) then raise exception 'Sem permissão'; end if;
 expected_count := coalesce(array_length(delivery_ids,1),0);
 if expected_count < 2 or expected_count > 15 then raise exception 'Selecione entre 2 e 15 entregas'; end if;
 if (select count(distinct x) from unnest(delivery_ids) x) <> expected_count then raise exception 'Pedidos repetidos'; end if;
 select delivery_mode into mode from public.stores where id=s;
 select fleet_type into fleet from public.couriers where id=courier and active;
 if fleet is null or not public.can_manage_courier(courier,s) or
   (fleet='propria' and mode not in ('propria','ambas')) or
   (fleet='compartilhada' and mode not in ('compartilhada','ambas')) then
   raise exception 'Entregador não autorizado';
 end if;
 -- Lock rows before checking eligibility to avoid concurrent assignments.
 perform 1 from public.deliveries where id=any(delivery_ids) for update;
 select count(*) into matching_count from public.deliveries
 where id=any(delivery_ids) and store_id=s and status in ('pendente','atribuida') and batch_id is null;
 if matching_count <> expected_count then raise exception 'Uma ou mais entregas não estão disponíveis'; end if;
 insert into public.delivery_batches(store_id,courier_id,created_by)
 values(s,courier,(select auth.uid())) returning id into batch;
 update public.deliveries set courier_id=courier,status='atribuida',batch_id=batch,updated_at=now()
 where id=any(delivery_ids);
 return batch;
end$$;
revoke all on function public.assign_delivery_batch(uuid,uuid,uuid[]) from public;
grant execute on function public.assign_delivery_batch(uuid,uuid,uuid[]) to authenticated;
