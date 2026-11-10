-- Customer restrictions apply only to Pitacco's own digital-menu orders.
begin;
create table if not exists public.pitacco_customer_blocks(
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id) on delete cascade,
 match_type text not null check(match_type in ('phone','name','address')),
 match_value text not null check(length(match_value) between 3 and 500),
 reason text not null default '',
 active boolean not null default true,
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid(),
 updated_at timestamptz not null default now(),
 released_at timestamptz,
 released_by uuid,
 check(length(reason)<=500)
);
create index if not exists pitacco_customer_blocks_lookup on public.pitacco_customer_blocks(store_id,match_type,match_value) where active;
alter table public.pitacco_customer_blocks enable row level security;
drop policy if exists pitacco_customer_blocks_manager on public.pitacco_customer_blocks;
create policy pitacco_customer_blocks_manager on public.pitacco_customer_blocks for select to authenticated using(public.is_store_manager(store_id));
revoke all on public.pitacco_customer_blocks from anon;
create or replace function public.pitacco_manage_customer_block(p_store uuid,p_type text,p_value text,p_reason text default '',p_expires timestamptz default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid; normalized text;
begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao';end if;
 if p_type not in ('phone','name','address') then raise exception 'Identificacao invalida';end if;
 normalized:=case when p_type='phone' then regexp_replace(coalesce(p_value,''),'[^0-9]','','g') else lower(trim(regexp_replace(coalesce(p_value,''),'[[:space:]]+',' ','g'))) end;
 if (p_type='phone' and length(normalized) not between 10 and 13) or (p_type<>'phone' and length(normalized) not between 5 and 500) then raise exception 'Identificacao incompleta';end if;
 if p_expires is not null and p_expires<=now() then raise exception 'Validade deve ser futura';end if;
 insert into public.pitacco_customer_blocks(store_id,match_type,match_value,reason,expires_at)
 values(p_store,p_type,normalized,left(coalesce(p_reason,''),500),p_expires) returning id into v;
 return v;
end $$;
create or replace function public.pitacco_release_customer_block(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 select store_id into s from public.pitacco_customer_blocks where id=p_id for update;
 if s is null or not public.is_store_manager(s) then raise exception 'Sem permissao';end if;
 update public.pitacco_customer_blocks set active=false,released_at=now(),released_by=auth.uid(),updated_at=now() where id=p_id and active;
end $$;
revoke all on function public.pitacco_manage_customer_block(uuid,text,text,text,timestamptz) from public,anon;
revoke all on function public.pitacco_release_customer_block(uuid) from public,anon;
grant execute on function public.pitacco_manage_customer_block(uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.pitacco_release_customer_block(uuid) to authenticated;
create or replace function public.pitacco_guard_own_checkout_block()
returns trigger language plpgsql security definer set search_path='' as $$
declare phone text;
begin
 if new.source<>'proprio' or coalesce(new.receipt->>'sales_channel','')='balcao' then return new;end if;
 phone:=regexp_replace(coalesce(new.receipt->>'phone',''),'[^0-9]','','g');
 if length(phone) between 10 and 13 and exists(
  select 1 from public.pitacco_customer_blocks b
  where b.store_id=new.store_id and b.match_type='phone' and b.match_value=phone
   and b.active and (b.expires_at is null or b.expires_at>now())
 ) then raise exception 'Nao foi possivel concluir o pedido neste momento. Entre em contato com o estabelecimento.';end if;
 -- Name/address matches require manual confirmation and never auto-reject.
 return new;
end $$;
drop trigger if exists pitacco_guard_own_checkout_block on public.orders;
create trigger pitacco_guard_own_checkout_block before insert on public.orders for each row execute function public.pitacco_guard_own_checkout_block();
commit;