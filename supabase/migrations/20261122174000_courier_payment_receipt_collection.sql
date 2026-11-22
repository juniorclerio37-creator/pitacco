-- Pagamento na entrega ocorre SOMENTE no fluxo do motoboy. Não cria
-- etapas/status adicionais no gestor de pedidos.
-- Guardamos a declaração de recebimento separadamente do status do gateway.
create or replace function pitacco_private.courier_payment_details(p_receipt jsonb,p_total numeric)
returns jsonb language plpgsql immutable set search_path to ''
as $body$
declare
 r jsonb:=coalesce(p_receipt,'{}'::jsonb);
 m text;
 s text;
 timing text;
 amount numeric:=coalesce(p_total,0);
 changeto numeric:=null;
 already boolean;
 providerpaid boolean;
 collect boolean;
 amttext text;
 changetext text;
begin
 m:=lower(pg_catalog.btrim(coalesce(nullif(r->>'payment_method',''),nullif(r->'payment'->>'method',''),
   case when jsonb_typeof(r->'payment')='string' then r->>'payment' else null end,
   nullif(r->>'payment_type',''),'')));
 s:=lower(pg_catalog.btrim(coalesce(nullif(r->>'payment_status',''),r->'payment'->>'status','')));
 timing:=lower(coalesce(r->>'payment_timing','')||' '||coalesce(r->>'payment_when','')||' '||
   coalesce(r->>'payment_location','')||' '||coalesce(r->>'payment_channel',''));
 already:=coalesce(r->'courier_collection'->>'received','false')='true';
 providerpaid:=coalesce(r->>'payment_confirmed','false')='true' or coalesce(r->>'paid','false')='true'
    or coalesce(r->>'is_paid','false')='true'
    or s in ('paid','approved','captured','confirmed','settled','pago','aprovado');
 collect:=not (already or providerpaid) and (
    coalesce(r->>'payment_on_delivery','false')='true'
    or coalesce(r->>'collect_on_delivery','false')='true'
    or timing ~ '(entrega|delivery|on.arrival|na_entrega|offline)'
    or m ~ '(^|[^a-z])(dinheiro|cash|cod|na entrega)([^a-z]|$)'
 );
 if coalesce(r->>'payment_on_delivery','')='false' and coalesce(r->>'collect_on_delivery','')='false'
   then collect:=false;
 end if;
 amttext:=coalesce(nullif(r->>'amount_to_collect',''),nullif(r->>'amount_due',''));
 if amttext is not null and amttext ~ '^[0-9]+(\.[0-9]{1,2})?$'
    then amount:=amttext::numeric; end if;
 changetext:=coalesce(nullif(r->>'change_for',''),nullif(r->>'troco_para',''),nullif(r->>'cash_given',''));
 if changetext is not null and changetext ~ '^[0-9]+(\.[0-9]{1,2})?$'
    then changeto:=changetext::numeric; end if;
 return pg_catalog.jsonb_build_object(
  'state',case when already or providerpaid then 'paid'
    when collect and amount>0 then 'collect' else 'unknown' end,
  'method',case
    when m in ('dinheiro','cash','cod') then 'Dinheiro'
    when m in ('pix','pix_manual') then 'Pix'
    when m in ('cartao','card') then 'Cartão'
    when m in ('credit_card','cartao_credito','credit') or m like '%credit%' then 'Cartão de crédito'
    when m in ('debit_card','cartao_debito','debit') or m like '%debit%' then 'Cartão de débito'
    when m='online' then 'Online'
    when m='' then 'Não informada' else left(m,70) end,
  'amount',amount,'change_for',changeto,
  'change_due',case when changeto is not null then greatest(changeto-amount,0) else null end,
  'received_by_courier',already,
  'received_at',r->'courier_collection'->>'received_at'
 );
end $body$;

-- Lista mínima e autorizada, para exibir o pagamento em cada cartão.
create or replace function public.pitacco_driver_payment_cards()
returns jsonb language plpgsql stable security definer set search_path to ''
as $body$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão de entregador não autorizada' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(
   pg_catalog.jsonb_build_object('delivery_id',d.id,'payment',
       pitacco_private.courier_payment_details(o.receipt,o.gross)
   ) order by d.created_at desc),'[]'::jsonb) into result
 from public.deliveries d
 join public.couriers c on c.id=d.courier_id and c.active
  and c.user_id=(select auth.uid())
  and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))
 left join public.orders o on o.id=d.order_id and o.store_id=d.store_id
 where d.logistics_provider='loja' and d.status in ('atribuida','aceita','retirada');
 return result;
end $body$;

-- Acionamento consciente: registra recebimento na entrega somente após
-- chegada confirmada pelo motoboy; nunca movimenta o estágio do gestor.
create or replace function public.pitacco_driver_confirm_payment(p_delivery uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $body$
declare d public.deliveries%rowtype;
 o public.orders%rowtype;
 summary jsonb;
 stamp timestamptz:=pg_catalog.now();
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
  raise exception 'Sessão do entregador não autorizada' using errcode='42501'; end if;
 select src.* into d from public.deliveries src
  join public.couriers c on c.id=src.courier_id and c.active
   and c.user_id=(select auth.uid())
   and (c.store_id=src.store_id or public.pitacco_courier_test_access(c.id,src.store_id))
 where src.id=p_delivery and src.logistics_provider='loja'
 for update of src;
 if not found then raise exception 'Entrega não atribuída ao entregador' using errcode='42501';end if;
 if d.status<>'retirada' or d.arrived_at is null then
  raise exception 'Registre a chegada antes da cobrança' using errcode='22023';end if;
 select * into o from public.orders where id=d.order_id and store_id=d.store_id for update;
 if not found then raise exception 'Pedido não encontrado' using errcode='22023';end if;
 summary:=pitacco_private.courier_payment_details(o.receipt,o.gross);
 if summary->>'state'='paid' and summary->>'received_by_courier'='true' then
  return summary; -- clique repetido: jamais duplicar recebimento/auditoria
 end if;
 if summary->>'state'<>'collect' then
  raise exception 'Este pedido não possui cobrança na entrega pendente' using errcode='22023';end if;
 update public.orders set receipt=pg_catalog.jsonb_set(coalesce(receipt,'{}'::jsonb),
  '{courier_collection}',pg_catalog.jsonb_build_object(
   'received',true,'received_at',stamp,'courier_id',d.courier_id,
   'amount',summary->'amount','method',summary->>'method',
   'confirmation','declared_by_courier'
  ),true)
  where id=o.id and store_id=d.store_id;
 insert into public.operation_audit(store_id,order_id,actor,action,details)
  values(d.store_id,d.order_id,(select auth.uid()),'courier_payment_received',
   pg_catalog.jsonb_build_object('delivery',d.id,'amount',summary->'amount',
      'method',summary->>'method','confirmed_at',stamp));
 return pitacco_private.courier_payment_details(
  (select receipt from public.orders where id=o.id),o.gross);
end $body$;

-- O código Pitacco não pode entregar um pedido próprio marcado para cobrar
-- sem o registro anterior da cobrança. iFood oficial não é modificado.
create or replace function pitacco_private.guard_own_delivery_cod()
returns trigger language plpgsql security definer set search_path to ''
as $body$
declare o public.orders%rowtype; payment jsonb;
begin
 if new.status='entregue' and old.status is distinct from 'entregue'
    and new.logistics_provider='loja' and new.source='proprio' then
  select * into o from public.orders where id=new.order_id and store_id=new.store_id;
  if found then
   payment:=pitacco_private.courier_payment_details(o.receipt,o.gross);
   if payment->>'state'='collect' then
    raise exception 'Confirme o recebimento da cobrança com o entregador antes de finalizar'
      using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end $body$;

drop trigger if exists trg_guard_own_delivery_cod on public.deliveries;
create trigger trg_guard_own_delivery_cod
before update of status on public.deliveries
for each row execute function pitacco_private.guard_own_delivery_cod();

revoke all on function public.pitacco_driver_payment_cards() from public,anon;
grant execute on function public.pitacco_driver_payment_cards() to authenticated;
revoke all on function public.pitacco_driver_confirm_payment(uuid) from public,anon;
grant execute on function public.pitacco_driver_confirm_payment(uuid) to authenticated;
