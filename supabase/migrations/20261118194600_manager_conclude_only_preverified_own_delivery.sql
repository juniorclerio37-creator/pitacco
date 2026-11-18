-- The merchant's Concluir entrega button is a retry/recovery action:
-- it cannot create delivery proof or impersonate marketplace completion.
create or replace function public.pitacco_manager_confirm_verified_delivery(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $body$
declare
 d public.deliveries%rowtype;
 o public.orders%rowtype;
begin
 if (select auth.uid()) is null then
   raise exception 'Sessão necessária' using errcode='42501';
 end if;
 select * into o from public.orders where id=p_order for share;
 if not found or not public.is_store_manager(o.store_id) then
   raise exception 'Pedido não autorizado para esta loja' using errcode='42501';
 end if;
 if o.source<>'proprio' then
   raise exception 'Pedidos de marketplaces exigem confirmação oficial da plataforma';
 end if;
 select * into d from public.deliveries
 where order_id=p_order and store_id=o.store_id and logistics_provider='loja'
 for update;
 if not found then
   raise exception 'Entrega própria não encontrada';
 end if;
 if d.status='entregue' then return; end if;
 if d.status<>'retirada' then
   raise exception 'A entrega ainda não saiu da loja';
 end if;
 if d.arrived_at is null or d.delivery_code_verified_at is null then
   raise exception 'Aguarde o entregador confirmar chegada e validar a comprovação da entrega';
 end if;
 update public.deliveries set status='entregue',updated_at=now() where id=d.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
 values(o.store_id,o.id,(select auth.uid()),'merchant_verified_delivery_completed',
        jsonb_build_object('delivery',d.id,'courier',d.courier_id,'proof_verified',true));
end;
$body$;
revoke all on function public.pitacco_manager_confirm_verified_delivery(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_manager_confirm_verified_delivery(uuid) to authenticated,service_role;