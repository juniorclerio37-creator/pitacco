-- Pitacco 0.13: advanced print routing, applied after 010_acceptance_printing.sql.
-- A sector with no filters continues to print every accepted order.
begin;
alter table public.print_sectors
 add column if not exists sources text[] not null default '{}',
 add column if not exists categories text[] not null default '{}';
alter table public.print_sectors
 drop constraint if exists print_sectors_sources_valid;
alter table public.print_sectors
 add constraint print_sectors_sources_valid check (sources <@ array['proprio','ifood','99food','keeta']::text[]);
create or replace function public.pitacco_route_print_job()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare allowed_sources text[]; allowed_categories text[]; chosen jsonb; original_items jsonb;
begin
 select sources,categories into allowed_sources,allowed_categories
 from public.print_sectors
 where store_id=new.store_id and sector=new.sector and enabled=true;
 if not found then return null; end if;
 if cardinality(allowed_sources)>0 and not (coalesce(new.receipt->>'source','')=any(allowed_sources)) then
  return null;
 end if;
 if cardinality(allowed_categories)>0 then
  original_items:=new.receipt->'items';
  if jsonb_typeof(original_items) <> 'array' then return null; end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into chosen
  from jsonb_array_elements(original_items) as item
  where lower(trim(coalesce(item->>'category',''))) = any (
   select lower(trim(c)) from unnest(allowed_categories) as c
  );
  if jsonb_array_length(chosen)=0 then return null; end if;
  new.receipt:=jsonb_set(new.receipt,'{items}',chosen);
  new.receipt_text:=public.dg_receipt_text(new.receipt)
   || 'Setor: ' || public.dg_clean_text(new.sector)
   || ' Via: ' || new.copy_no || chr(10);
  if new.request_id <> '00000000-0000-0000-0000-000000000000'::uuid then
   new.receipt_text:='REIMPRESSAO' || chr(10) || new.receipt_text;
  end if;
 end if;
 return new;
end$$;
drop trigger if exists pitacco_print_route on public.print_jobs;
create trigger pitacco_print_route before insert on public.print_jobs
 for each row execute function public.pitacco_route_print_job();
revoke all on function public.pitacco_route_print_job() from public,anon;
commit;
