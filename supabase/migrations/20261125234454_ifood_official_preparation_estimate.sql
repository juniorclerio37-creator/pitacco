
create table if not exists pitacco_private.ifood_preparation_estimates (
 merchant_id uuid not null, external_order_id uuid not null, event_at timestamptz not null,
 start_at timestamptz, due_at timestamptz not null, primary key(merchant_id,external_order_id)
);
alter table pitacco_private.ifood_preparation_estimates enable row level security;
revoke all on pitacco_private.ifood_preparation_estimates from public,anon,authenticated;
create or replace function public.pitacco_ifood_preparation_estimate(p_merchant uuid,p_order uuid,p_at timestamptz,p_start timestamptz,p_due timestamptz,p_production boolean,p_distributed boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid; rec pitacco_private.ifood_preparation_estimates%rowtype;
begin
 if p_due is null or p_at is null or p_due<p_at-interval '1 day' or p_due>p_at+interval '14 days' or (p_start is not null and p_start>p_due) then return false;end if;
 select store_id into sid from pitacco_private.ifood_merchants where merchant_id=p_merchant and enabled and (credential is not null)=p_distributed and (p_distributed or test_only=not p_production);
 if not found then return false;end if;
 insert into pitacco_private.ifood_preparation_estimates(merchant_id,external_order_id,event_at,start_at,due_at) values(p_merchant,p_order,p_at,p_start,p_due)
 on conflict(merchant_id,external_order_id) do update set event_at=excluded.event_at,start_at=excluded.start_at,due_at=excluded.due_at where excluded.event_at>ifood_preparation_estimates.event_at;
 select * into rec from pitacco_private.ifood_preparation_estimates where merchant_id=p_merchant and external_order_id=p_order;
 update public.orders o set receipt=coalesce(o.receipt,'{}'::jsonb)||jsonb_build_object('provider_preparation_due_at',rec.due_at,'provider_preparation_start_at',rec.start_at)
 from pitacco_private.ifood_order_links l where l.merchant_id=p_merchant and l.external_id=p_order and l.order_id=o.id and o.store_id=sid and o.source='ifood' and o.status in ('pending','accepted') and o.preparation_status='preparing';
 return true;
end $$;
revoke all on function public.pitacco_ifood_preparation_estimate(uuid,uuid,timestamptz,timestamptz,timestamptz,boolean,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_ifood_preparation_estimate(uuid,uuid,timestamptz,timestamptz,timestamptz,boolean,boolean) to service_role;
create or replace function pitacco_private.ifood_apply_preparation_estimate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.orders o set receipt=coalesce(o.receipt,'{}'::jsonb)||jsonb_build_object('provider_preparation_due_at',e.due_at,'provider_preparation_start_at',e.start_at)
 from pitacco_private.ifood_preparation_estimates e join pitacco_private.ifood_merchants m on m.merchant_id=e.merchant_id
 where e.merchant_id=new.merchant_id and e.external_order_id=new.external_id and o.id=new.order_id and o.store_id=m.store_id and o.source='ifood' and o.preparation_status='preparing';
 return new;
end $$;
drop trigger if exists pitacco_ifood_apply_preparation_estimate on pitacco_private.ifood_order_links;
create trigger pitacco_ifood_apply_preparation_estimate after insert on pitacco_private.ifood_order_links for each row execute function pitacco_private.ifood_apply_preparation_estimate();
-- Retain marketplace's own delivery deadline for logistics, independently of prep.
do $patch$
declare f text;
begin
 select pg_get_functiondef('pitacco_private.group_copy_coordinates()'::regprocedure) into f;
 f:=replace(f,'rec#>>''{delivery_eta,latest_at}'' is not null','coalesce(rec#>>''{delivery_eta,latest_at}'',rec->>''provider_delivery_due_at'') is not null');
 f:=replace(f,'(rec#>>''{delivery_eta,latest_at}'')::timestamptz','coalesce(rec#>>''{delivery_eta,latest_at}'',rec->>''provider_delivery_due_at'')::timestamptz');
 execute f;
end $patch$;

