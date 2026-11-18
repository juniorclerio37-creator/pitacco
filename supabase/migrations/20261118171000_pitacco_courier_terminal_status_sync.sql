-- Official iFood terminal events and own-menu cancellations update assigned
-- courier deliveries on the server, not by a client-side hidden-card trick.
--
-- iFood provider proof: only a processed, matching official event may bypass
-- local PIN/arrival checks. This DOES NOT mark a local PIN as verified.
create or replace function pitacco_private.require_courier_arrival_and_proof()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
 if new.status='entregue' and old.status<>'entregue'
    and new.logistics_provider='loja' and new.courier_id is not null then
  if new.arrived_at is null or new.delivery_code_verified_at is null then
   if new.source is distinct from 'ifood'
      or new.external_delivery_status is distinct from 'CONCLUDED'
      or not exists(
       select 1 from public.orders o
       join pitacco_private.ifood_order_links l on l.order_id=o.id
       join pitacco_private.ifood_events e
         on e.order_id=l.external_id and e.merchant_id=l.merchant_id
       where o.id=new.order_id and o.store_id=new.store_id
         and o.source='ifood'
         and o.receipt->>'ifood_status'='CONCLUDED'
         and e.code='CONCLUDED' and e.done_at is not null
      ) then
    raise exception 'Chegada e código de entrega verificado são obrigatórios'
      using errcode='23514';
   end if;
  end if;
 end if;
 return new;
end $$;

-- Called only when the verified ingestion queue commits the terminal event.
-- Never trust a browser-provided status or mark a code as verified.
create or replace function pitacco_private.sync_ifood_delivery_terminal()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare
 v_order uuid;
 v_store uuid;
 v_changed integer;
begin
 if new.done_at is null or old.done_at is not null
    or new.code not in ('CONCLUDED','CANCELLED') then return new; end if;

 select o.id,o.store_id into v_order,v_store
 from pitacco_private.ifood_order_links l
 join pitacco_private.ifood_merchants m on m.merchant_id=l.merchant_id
 join public.orders o on o.id=l.order_id and o.store_id=m.store_id
 where l.external_id=new.order_id and l.merchant_id=new.merchant_id
   and o.source='ifood'
   and o.receipt->>'ifood_status'=new.code
   and (new.code<>'CANCELLED' or o.status='cancelled');
 if v_order is null then return new;end if;

 if new.code='CANCELLED' then
  update public.deliveries d set
    status='cancelada',
    external_delivery_status='CANCELLED',
    courier_payment=0,
    updated_at=pg_catalog.now()
  where d.order_id=v_order and d.store_id=v_store
    and d.source='ifood' and d.logistics_provider='loja'
    and d.status<>'cancelada';
 else
  update public.deliveries d set
    status='entregue',
    external_delivery_status='CONCLUDED',
    updated_at=pg_catalog.now()
  where d.order_id=v_order and d.store_id=v_store
    and d.source='ifood' and d.logistics_provider='loja'
    and d.status not in ('entregue','cancelada');
 end if;
 get diagnostics v_changed=row_count;
 if v_changed>0 then
  insert into public.operation_audit(store_id,order_id,action,details)
  values(v_store,v_order,'ifood_courier_terminal_synced',
    pg_catalog.jsonb_build_object('provider_event',new.code,
      'affected_deliveries',v_changed,'verified_by','official_ifood_event'));
 end if;
 return new;
end $$;
drop trigger if exists pitacco_ifood_courier_terminal_sync on pitacco_private.ifood_events;
create trigger pitacco_ifood_courier_terminal_sync
after update of done_at on pitacco_private.ifood_events
for each row when (old.done_at is null and new.done_at is not null)
execute function pitacco_private.sync_ifood_delivery_terminal();

-- The own digital menu is authoritative for its cancellation; a canceled
-- own order is removed from the courier's active list without paying it.
create or replace function pitacco_private.sync_own_delivery_cancellation()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
 if new.source='proprio' and new.status='cancelled'
    and old.status is distinct from new.status then
  update public.deliveries d set
    status='cancelada',courier_payment=0,updated_at=pg_catalog.now()
  where d.order_id=new.id and d.store_id=new.store_id
    and d.source='proprio' and d.status<>'cancelada';
 end if;
 return new;
end $$;
drop trigger if exists pitacco_own_courier_cancel_sync on public.orders;
create trigger pitacco_own_courier_cancel_sync
after update of status on public.orders
for each row when (new.source='proprio' and new.status='cancelled'
  and old.status is distinct from new.status)
execute function pitacco_private.sync_own_delivery_cancellation();

-- Existing assignments whose iFood terminal event was processed before this
-- migration should also stop appearing in the active courier queue.
update public.deliveries d
set status=case when o.receipt->>'ifood_status'='CANCELLED' then 'cancelada' else 'entregue' end,
    external_delivery_status=o.receipt->>'ifood_status',
    courier_payment=case when o.receipt->>'ifood_status'='CANCELLED'
      then 0 else d.courier_payment end,
    updated_at=pg_catalog.now()
from public.orders o
join pitacco_private.ifood_order_links l on l.order_id=o.id
where o.id=d.order_id and o.store_id=d.store_id and o.source='ifood'
  and d.source='ifood' and d.logistics_provider='loja'
  and o.receipt->>'ifood_status' in ('CONCLUDED','CANCELLED')
  and ((o.receipt->>'ifood_status'='CANCELLED' and d.status<>'cancelada')
    or (o.receipt->>'ifood_status'='CONCLUDED'
        and d.status not in ('entregue','cancelada')))
  and exists (
    select 1 from pitacco_private.ifood_events e
    where e.order_id=l.external_id and e.merchant_id=l.merchant_id
      and e.code=o.receipt->>'ifood_status' and e.done_at is not null
  );

update public.deliveries d
set status='cancelada',courier_payment=0,updated_at=pg_catalog.now()
from public.orders o
where o.id=d.order_id and o.store_id=d.store_id
  and o.source='proprio' and o.status='cancelled'
  and d.source='proprio' and d.status<>'cancelada';

-- Both terminal states appear in the protected courier history; cancellations
-- always have zero earnings and remain excluded from monetary aggregates.
create or replace function public.pitacco_driver_history(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare output jsonb;
begin
 if (select auth.uid()) is null or not public.pitacco_courier_session_ready() then
   raise exception 'Sessão do entregador não autorizada' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>50 then
   raise exception 'Limite inválido' using errcode='22023';end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'number',coalesce(public.pitacco_order_public_label(r.receipt,coalesce(r.source,d.source)),'Número indisponível'),
    'source',d.source,
    'status',d.status,
    'completed_at',case when d.status='entregue' then d.updated_at else null end,
    'finished_at',d.updated_at,
    'arrived_at',d.arrived_at,
    'amount',case when d.status='entregue' then d.courier_payment else 0 end,
    'initial',case when nullif(pg_catalog.btrim(d.customer_name),'') is null then 'C.'
               else pg_catalog.upper(pg_catalog.left(pg_catalog.btrim(d.customer_name),1))||'.' end,
    'address_hint',case when nullif(pg_catalog.btrim(d.address),'') is null then 'Endereço resumido indisponível'
       else pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(d.address,',',1)),8)||'…' end
   ) order by d.updated_at desc),'[]'::jsonb) into output
 from (
   select d.* from public.deliveries d
   join public.couriers c on c.id=d.courier_id and c.active
      and (c.store_id=d.store_id or public.pitacco_courier_test_access(c.id,d.store_id))
   where c.user_id=(select auth.uid())
     and d.status in ('entregue','cancelada')
     and d.logistics_provider='loja'
   order by d.updated_at desc limit p_limit
 ) d
 left join public.orders r on r.id=d.order_id and r.store_id=d.store_id;
 return output;
end $$;
revoke all on function public.pitacco_driver_history(integer) from public,anon;
grant execute on function public.pitacco_driver_history(integer) to authenticated;
notify pgrst,'reload schema';
