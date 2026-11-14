-- Restrict this operation to orders that have not been accepted, charged or dispatched.
alter table public.orders
  add constraint orders_pitacco_status_check check (status in ('historical','pending','accepted','cancelled','rejected')) not valid;
alter table public.orders validate constraint orders_pitacco_status_check;
alter table public.orders drop constraint orders_status_check;

create function public.pitacco_decide_pending_order(p_order uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  target public.orders%rowtype;
  reason text := public.dg_clean_text(btrim(coalesce(p_reason,'')));
begin
  if auth.uid() is null or p_status is null or p_status not in ('cancelled','rejected')
     or char_length(reason) not between 3 and 240 then
    raise exception 'Informe uma decisão válida e o motivo';
  end if;
  select * into target from public.orders
   where id = p_order and public.is_store_manager(store_id) for update;
  if not found then
    raise exception 'Pedido indisponível para este usuário';
  end if;
  if target.status = p_status then return; end if;
  if target.status <> 'pending' or target.source <> 'proprio' then
    raise exception 'A decisão só está disponível para pedidos próprios pendentes';
  end if;
  if exists (select 1 from public.manual_payments where order_id = target.id)
     or exists (select 1 from public.store_payment_receipts where order_id = target.id)
     or exists (select 1 from public.deliveries where order_id = target.id) then
    raise exception 'O pedido já possui pagamento ou entrega registrada';
  end if;

  update public.orders set status = p_status where id = target.id;
  insert into public.operation_audit(store_id,order_id,actor,action,details)
  values (target.store_id,target.id,auth.uid(),
    case p_status when 'cancelled' then 'order_cancelled' else 'order_rejected' end,
    jsonb_build_object('reason',reason));
end;
$function$;
revoke all on function public.pitacco_decide_pending_order(uuid,text,text) from public, anon;
grant execute on function public.pitacco_decide_pending_order(uuid,text,text) to authenticated;
