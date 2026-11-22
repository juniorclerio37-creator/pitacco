-- Geração criptograficamente segura sem dependência do schema extensions em ambientes isolados.
create or replace function pitacco_private.issue_own_delivery_code()
returns trigger language plpgsql security definer set search_path to ''
as $body$
declare n bigint; digits int;
begin
 if new.source='proprio' and new.logistics_provider='loja'
  and exists(select 1 from public.orders o
    where o.id=new.order_id and o.store_id=new.store_id and o.source='proprio') then
  digits:=coalesce((select s.digits::int from public.pitacco_store_delivery_code_settings s
    where s.store_id=new.store_id),6);
  n:=('x'||pg_catalog.substring(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','') from 1 for 8))::bit(32)::bigint
    % pg_catalog.power(10,digits)::bigint;
  insert into public.pitacco_own_delivery_codes(delivery_id,store_id,code)
   values(new.id,new.store_id,pg_catalog.lpad(n::text,digits,'0'))
   on conflict(delivery_id) do nothing;
 end if;
 return new;
end $body$;
