-- ONLY Clério can serve the iFood test store as well as his existing Açaí do Linho store.
-- Do not duplicate logins, alter courier.store_id or change the permitted fleet policy.
create table if not exists pitacco_private.courier_test_store_access (
 courier_id uuid not null references public.couriers(id),
 store_id uuid not null references public.stores(id),
 granted_at timestamptz not null default now(),
 primary key(courier_id,store_id),
 constraint only_clerio_test_store check (courier_id='d2c2d04a-8545-449f-94f3-b67f5237d6c3'::uuid and store_id='1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid)
);
revoke all on pitacco_private.courier_test_store_access from public, anon, authenticated;
-- Apply the special link only if both existing production records are present.
-- Isolated CI databases intentionally do not contain this real courier.
insert into pitacco_private.courier_test_store_access(courier_id,store_id)
select c.id,'1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid
from public.couriers c
where c.id='d2c2d04a-8545-449f-94f3-b67f5237d6c3'::uuid
  and c.store_id='8732707e-e0e4-47af-b930-3e7d2d9042b9'::uuid
  and exists (select 1 from public.stores s where s.id='1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid)
on conflict do nothing;

create or replace function public.pitacco_courier_test_access(p_courier uuid,p_store uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from pitacco_private.courier_test_store_access g
  join public.couriers c on c.id=g.courier_id
  where g.courier_id=p_courier and g.store_id=p_store
   and c.active and c.fleet_type='propria' and c.store_id='8732707e-e0e4-47af-b930-3e7d2d9042b9'::uuid
 );
$$;
revoke all on function public.pitacco_courier_test_access(uuid,uuid) from public,anon;
grant execute on function public.pitacco_courier_test_access(uuid,uuid) to authenticated,service_role;

-- Replace only the original store authorization clause; preserve route safety rules.
CREATE OR REPLACE FUNCTION public.dg_assign_route(d uuid, c uuid, confirmed boolean, automatic boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rec public.deliveries%rowtype; cr public.couriers%rowtype; b uuid; cap integer; s uuid; mode text;
begin
 select store_id into s from public.deliveries where id=d;
 if s is null then raise exception 'Entrega inexistente';end if;
 if not (public.can_access_store(s) or coalesce(auth.jwt()->>'role','') = 'service_role') then raise exception 'Sem permissão para atribuir entregador'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s::text,13));
 select * into cr from public.couriers where id=c for update;
 if not found or not cr.active then raise exception 'Entregador indisponível';end if;
 if (cr.fleet_type='propria' and cr.store_id<>s and not public.pitacco_courier_test_access(c,s)) or (cr.fleet_type='compartilhada' and (automatic or not public.is_admin())) then raise exception 'Entregador não autorizado';end if;
 select max_orders_per_trip,delivery_mode into cap,mode from public.stores where id=s;
 if (cr.fleet_type='propria' and mode not in ('propria','ambas')) or (cr.fleet_type='compartilhada' and mode not in ('compartilhada','ambas')) then raise exception 'Frota não habilitada';end if;
 select * into rec from public.deliveries where id=d for update;
 if rec.logistics_provider<>'loja' then raise exception 'Entrega já pertence à plataforma';end if;
 if rec.courier_id=c and rec.batch_id is not null then return rec.batch_id;end if;
 if rec.status<>'pendente' or rec.courier_id is not null or rec.batch_id is not null then raise exception 'Entrega já atribuída ou encerrada';end if;
 if exists(select 1 from public.deliveries x left join public.delivery_batches r on r.id=x.batch_id where x.courier_id=c and x.status not in ('entregue','cancelada') and (x.batch_id is null or r.departed_at is not null or r.store_id<>s)) then raise exception 'Entregador ocupado: rota já saiu ou viagem anterior aberta';end if;
 select id into b from public.delivery_batches where courier_id=c and store_id=s and completed_at is null order by created_at limit 1 for update;
 if b is not null then
  if (select departed_at is not null from public.delivery_batches where id=b) then raise exception 'Rota já saiu da loja';end if;
  if not confirmed then raise exception 'Confirme o possível desvio antes de agrupar manualmente';end if;
  if (select count(*) from public.deliveries where batch_id=b and status<>'cancelada')>=cap then raise exception 'Limite de pedidos por rota atingido';end if;
 else
  insert into public.delivery_batches(store_id,courier_id,created_by) values(s,c,coalesce(auth.uid(),cr.user_id)) returning id into b;
 end if;
 if automatic and (not cr.available or not exists(select 1 from public.courier_positions where courier_id=c and observed_at>now()-interval '90 seconds')) then raise exception 'Entregador offline ou GPS desatualizado';end if;
 update public.deliveries set courier_id=c,batch_id=b,status='atribuida',updated_at=now() where id=d;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(s,rec.order_id,auth.uid(),case when automatic then 'route_auto_assigned' else 'route_manual_assigned' end,jsonb_build_object('delivery',d,'courier',c,'route',b,'deviation_confirmed',confirmed));
 return b;
end$function$
;

create or replace function public.pitacco_store_couriers(p_store uuid)
returns setof public.couriers language plpgsql stable security definer set search_path='' as $$
begin
 if p_store is null or not public.is_store_manager(p_store) then
  raise exception 'Sem permissão para consultar entregadores desta loja' using errcode='42501';
 end if;
 return query select c.* from public.couriers c
 where c.active=true and (c.store_id=p_store or public.pitacco_courier_test_access(c.id,p_store))
 order by c.name,c.id;
end;
$$;
revoke all on function public.pitacco_store_couriers(uuid) from public,anon;
grant execute on function public.pitacco_store_couriers(uuid) to authenticated;

drop policy if exists courier_test_store_manager_read on public.couriers;
create policy courier_test_store_manager_read on public.couriers for select to authenticated
using (public.pitacco_courier_test_access(id,'1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid) and public.is_store_manager('1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid));
drop policy if exists courier_test_store_manager_positions on public.courier_positions;
create policy courier_test_store_manager_positions on public.courier_positions for select to authenticated
using (public.pitacco_courier_test_access(courier_id,'1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid) and public.is_store_manager('1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid));
drop policy if exists courier_test_store_delivery_read on public.deliveries;
-- The production courier app enforces its active authenticated session.
-- CI's standalone schema intentionally omits that function and all real couriers.
-- Never authorize a live test courier without the production session check.
do $pitacco$
begin
 if to_regprocedure('public.pitacco_courier_session_ready()') is not null then
  execute $policy$
   create policy courier_test_store_delivery_read on public.deliveries for select to authenticated
   using (
    store_id='1481c0c6-5b87-4737-9d1a-96ae5c1615d9'::uuid
    and status not in ('entregue','cancelada')
    and courier_id='d2c2d04a-8545-449f-94f3-b67f5237d6c3'::uuid
    and public.pitacco_courier_test_access(courier_id,store_id)
    and public.is_courier(courier_id)
    and (select public.pitacco_courier_session_ready())
   )
  $policy$;
 elsif exists (select 1 from pitacco_private.courier_test_store_access) then
  raise exception 'A sessão do entregador é obrigatória para liberar entregas nesta loja';
 end if;
end;
$pitacco$;
notify pgrst, 'reload schema';
