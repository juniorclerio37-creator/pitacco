-- Allow the one expressly authorized cross-store test courier to receive push.
-- Existing self-store matching and all other access rules remain unchanged.
create or replace function pitacco_private.enqueue_courier_push()
returns trigger
language plpgsql security definer set search_path='' as $push$
begin
 if new.status<>'atribuida' or new.courier_id is null
    or new.logistics_provider is distinct from 'loja' then return new; end if;
 if tg_op='UPDATE' then
  if old.status=new.status and old.courier_id is not distinct from new.courier_id then return new; end if;
 end if;
 if not exists(select 1 from pitacco_private.courier_push_settings where enabled) then return new; end if;
 if not exists(
  select 1 from public.couriers c
  where c.id=new.courier_id and c.active and c.available
    and (c.store_id=new.store_id or public.pitacco_courier_test_access(c.id,new.store_id))
 ) then return new; end if;
 insert into pitacco_private.courier_push_outbox(delivery_id,courier_id,expires_at)
 values(new.id,new.courier_id,now()+interval '3 minutes')
 on conflict(delivery_id) do update set courier_id=excluded.courier_id,event_id=excluded.event_id,
   expires_at=excluded.expires_at,available_at=now(),attempts=0,sent_at=null;
 return new;
end $push$;
