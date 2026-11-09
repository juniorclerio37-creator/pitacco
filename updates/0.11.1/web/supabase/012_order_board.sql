begin;
alter table public.orders add column if not exists preparation_status text not null default 'preparing' check(preparation_status in ('preparing','ready','completed'));
create or replace function public.set_order_preparation(p_order uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.is_store_manager(o.store_id) then raise exception 'Sem permissao';end if;
 if o.status<>'accepted' or o.source<>'proprio' then raise exception 'Somente pedidos proprios aceitos podem avancar';end if;
 if p_status is null or p_status not in ('ready','completed') then raise exception 'Etapa invalida';end if;
 if o.preparation_status=p_status then return;end if;
 if exists(select 1 from public.deliveries where order_id=o.id and status in ('retirada','entregue','cancelada')) then raise exception 'Pedido ja encaminhado para entrega';end if;
 if not ((o.preparation_status='preparing' and p_status='ready') or (o.preparation_status='ready' and p_status='completed' and o.receipt->>'logistics'='retirada')) then raise exception 'Transicao invalida';end if;
 update public.orders set preparation_status=p_status where id=o.id;
 insert into public.operation_audit(store_id,order_id,actor,action,details) values(o.store_id,o.id,auth.uid(),'preparation_changed',jsonb_build_object('from',o.preparation_status,'to',p_status));
end $$;
revoke all on function public.set_order_preparation(uuid,text) from public,anon,authenticated;
grant execute on function public.set_order_preparation(uuid,text) to authenticated;
commit;
