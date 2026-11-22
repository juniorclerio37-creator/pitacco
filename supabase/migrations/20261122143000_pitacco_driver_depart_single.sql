-- Entrega avulsa: despacho sem lote. Só pode sair depois da coleta,
-- pela sessão do motoboy ativo que recebeu o pedido daquela loja.
-- A conclusão permanece exclusiva do código ou evento oficial.
create or replace function public.pitacco_driver_depart_single(p_delivery uuid)
returns void
language plpgsql security definer
set search_path to ''
as $function$
declare
  d public.deliveries%rowtype;
begin
  if (select auth.uid()) is null
     or not public.pitacco_courier_session_ready() then
    raise exception 'Sessão do entregador não autorizada' using errcode='42501';
  end if;

  select src.* into d
  from public.deliveries src
  join public.couriers c on c.id=src.courier_id
    and c.user_id=(select auth.uid()) and c.active
    and (c.store_id=src.store_id
      or public.pitacco_courier_test_access(c.id,src.store_id))
  where src.id=p_delivery and src.logistics_provider='loja'
  for update of src;

  if not found then
    raise exception 'Entrega não atribuída a este entregador' using errcode='42501';
  end if;
  if d.batch_id is not null then
    raise exception 'Utilize a saída da rota agrupada' using errcode='22023';
  end if;
  if d.status='retirada' and d.collected_at is not null then
    return; -- segura em caso de repetição da mesma ação
  end if;
  if d.status<>'aceita' or d.collected_at is null then
    raise exception 'Confirme primeiro a coleta antes da saída' using errcode='22023';
  end if;

  update public.deliveries
    set status='retirada',updated_at=pg_catalog.now()
    where id=d.id;
  insert into public.operation_audit(store_id,order_id,actor,action,details)
    values(d.store_id,d.order_id,(select auth.uid()),'courier_departed_single',
      pg_catalog.jsonb_build_object('delivery',d.id,'courier',d.courier_id));
end;
$function$;

revoke all on function public.pitacco_driver_depart_single(uuid) from public,anon;
grant execute on function public.pitacco_driver_depart_single(uuid) to authenticated;
