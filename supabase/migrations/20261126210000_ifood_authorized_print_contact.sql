-- Return active iFood own-delivery contact only to the authenticated, bound printer.
-- The print_jobs receipt and orders history are never modified by this enrichment.
-- Older isolated fixtures may not yet contain the restricted contact table.
create table if not exists public.pitacco_delivery_customer_contacts (
 delivery_id uuid primary key references public.deliveries(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 phone_number text, phone_localizer text, phone_expires_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.pitacco_delivery_customer_contacts enable row level security;
revoke all on table public.pitacco_delivery_customer_contacts from public, anon, authenticated;
grant select,insert,update,delete on table public.pitacco_delivery_customer_contacts to service_role;

create or replace function public.claim_print_jobs(p_store uuid,p_device uuid)
returns setof public.print_jobs language plpgsql security definer set search_path=''
as $function$
begin
 if (select auth.uid()) is null or not public.is_store_manager(p_store) or not exists(
  select 1 from public.print_devices where store_id=p_store and device_id=p_device
 ) then raise exception 'Dispositivo nao autorizado'; end if;
 with picked as (
  select id from public.print_jobs where store_id=p_store and state='pending' and device_id is null
  order by created_at,id for update skip locked limit 100
 ) update public.print_jobs j set device_id=p_device,state='claimed',updated_at=now()
 from picked where j.id=picked.id;
 return query
 select (pg_catalog.jsonb_populate_record(j,pg_catalog.jsonb_build_object('receipt',
   case when c.phone_number is not null or c.phone_localizer is not null then
     j.receipt || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
       'phone',c.phone_number,'localizer',c.phone_localizer,'phone_localizer_expiration',c.phone_expires_at))
   else j.receipt end))).*
 from public.print_jobs j
 left join lateral (
   select ct.phone_number,ct.phone_localizer,ct.phone_expires_at
   from public.orders o
   join public.deliveries d on d.order_id=o.id and d.store_id=o.store_id
   join public.pitacco_delivery_customer_contacts ct on ct.delivery_id=d.id and ct.store_id=d.store_id
   where o.id=j.order_id and o.store_id=j.store_id and o.source='ifood' and o.status='accepted'
     and o.preparation_status<>'completed' and d.source='ifood' and d.logistics_provider='loja'
     and d.status not in ('cancelada','entregue')
     and (ct.phone_expires_at is null or ct.phone_expires_at>now())
   order by ct.updated_at desc limit 1
 ) c on true
 where j.store_id=p_store and j.device_id=p_device and j.state<>'submitted'
 order by (j.state in ('claimed','saved')) desc,j.created_at,j.id limit 100;
end
$function$;
revoke all on function public.claim_print_jobs(uuid,uuid) from public,anon;
grant execute on function public.claim_print_jobs(uuid,uuid) to authenticated;
