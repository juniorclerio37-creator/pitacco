-- Transições explícitas do Pitacco Entregador.
-- 'aceita' permanece como status técnico legado de "coletada e aguardando saída".
-- O entregador NÃO aceita nem recusa; confirma a coleta diretamente.
create or replace function public.pitacco_driver_collect(p_delivery uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare d public.deliveries%rowtype;
begin
  if not public.pitacco_courier_session_ready() then
    raise exception 'Sessão não liberada';
  end if;
  select * into d from public.deliveries where id = p_delivery for update;
  if not found or d.logistics_provider <> 'loja' or
     d.courier_id is null or not public.is_courier(d.courier_id) then
    raise exception 'Entrega não atribuída a este entregador';
  end if;
  if d.batch_id is not null and exists (
    select 1 from public.delivery_batches b
    where b.id = d.batch_id and (b.departed_at is not null or b.completed_at is not null)
  ) then
    raise exception 'Rota já saiu da loja';
  end if;
  if d.status = 'aceita' and d.collected_at is not null then return; end if;
  if d.status not in ('atribuida','aceita') then raise exception 'Entrega não está aguardando coleta'; end if;
  update public.deliveries
     set status = 'aceita', collected_at = now(), updated_at = now()
   where id = d.id;
  insert into public.operation_audit(store_id,order_id,actor,action,details)
  values(d.store_id,d.order_id,(select auth.uid()),'courier_collected',
         jsonb_build_object('delivery',d.id,'route',d.batch_id));
end;
$$;
revoke all on function public.pitacco_driver_collect(uuid) from public, anon;
grant execute on function public.pitacco_driver_collect(uuid) to authenticated;

create or replace function public.pitacco_driver_depart(p_batch uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.pitacco_courier_session_ready() then
    raise exception 'Sessão não liberada';
  end if;
  if not exists (
    select 1 from public.delivery_batches b
      join public.couriers c on c.id = b.courier_id
    where b.id = p_batch and c.active = true
      and c.user_id = (select auth.uid()) and c.store_id = b.store_id
  ) then raise exception 'Rota indisponível para este entregador'; end if;
  perform public.depart_route(p_batch);
end;
$$;
revoke all on function public.pitacco_driver_depart(uuid) from public, anon;
grant execute on function public.pitacco_driver_depart(uuid) to authenticated;

create or replace function public.pitacco_driver_online(p_online boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.pitacco_courier_session_ready() then
    raise exception 'Sessão não liberada';
  end if;
  perform public.set_courier_availability(p_online);
end;
$$;
revoke all on function public.pitacco_driver_online(boolean) from public, anon;
grant execute on function public.pitacco_driver_online(boolean) to authenticated;
