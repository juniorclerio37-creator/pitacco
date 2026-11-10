-- Stable public order numbers; internal UUID remains unchanged.
begin;
create table if not exists public.pitacco_order_sequences(
 store_id uuid not null references public.stores(id) on delete cascade,
 prefix text not null check(prefix in ('D','B')),
 last_number bigint not null default 1000,
 primary key(store_id,prefix)
);
alter table public.pitacco_order_sequences enable row level security;
revoke all on public.pitacco_order_sequences from public,anon,authenticated;
create or replace function public.pitacco_assign_order_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare pref text; seq bigint; external_no text;
begin
 if new.source in ('ifood','99food','keeta') then
  external_no:=nullif(trim(coalesce(new.receipt->>'external_order_number',new.receipt->>'order_number',new.receipt->>'display_id',new.receipt->>'number','')),'');
  if external_no is not null then
   new.receipt:=jsonb_set(coalesce(new.receipt,'{}'::jsonb),'{display_number}',to_jsonb(external_no),true);
  end if;
  return new;
 end if;
 if new.source<>'proprio' then return new; end if;
 if nullif(new.receipt->>'display_number','') is not null then return new; end if;
 pref:=case when new.receipt->>'sales_channel'='balcao' then 'B' else 'D' end;
 insert into public.pitacco_order_sequences(store_id,prefix,last_number)
 values(new.store_id,pref,1001)
 on conflict(store_id,prefix) do update set last_number=public.pitacco_order_sequences.last_number+1
 returning last_number into seq;
 new.receipt:=jsonb_set(coalesce(new.receipt,'{}'::jsonb),'{display_number}',to_jsonb(pref||'-'||seq::text),true);
 return new;
end $$;
drop trigger if exists pitacco_order_number_before_insert on public.orders;
create trigger pitacco_order_number_before_insert
 before insert on public.orders for each row execute function public.pitacco_assign_order_number();
revoke all on function public.pitacco_assign_order_number() from public,anon,authenticated;
-- Existing orders retain their recorded marketplace number; do not fabricate one.
commit;
