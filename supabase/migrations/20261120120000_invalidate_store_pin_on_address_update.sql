-- Hide numeric location fields from the merchant: the registered street address
-- and the exact draggable map point are the only configuration needed.
-- When an address changes, invalidate the previously pinned store position.
-- Pure identity/telephone/logo updates do NOT invalidate the store pin.
create or replace function pitacco_private.invalidate_store_point_on_address_edit()
returns trigger language plpgsql set search_path = '' as $$
begin
 if row(new.address,new.address_number,new.neighborhood,new.city,new.state,new.postal_code)
    is distinct from
    row(old.address,old.address_number,old.neighborhood,old.city,old.state,old.postal_code)
 then
   new.latitude := null;
   new.longitude := null;
 end if;
 return new;
end;
$$;

drop trigger if exists pitacco_store_address_invalidate_location on public.stores;
create trigger pitacco_store_address_invalidate_location
before update of address,address_number,neighborhood,city,state,postal_code
on public.stores
for each row execute function pitacco_private.invalidate_store_point_on_address_edit();
