create table if not exists pitacco_private.auto_print_preferences (
 store_id uuid primary key references public.stores(id) on delete cascade,
 enabled boolean not null default true,
 enabled_since timestamptz,
 updated_at timestamptz not null default now()
);
alter table pitacco_private.auto_print_preferences enable row level security;
revoke all on pitacco_private.auto_print_preferences from public,anon,authenticated;
create or replace function public.pitacco_auto_print_status(p_store uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão' using errcode='42501'; end if;
 return coalesce((select enabled from pitacco_private.auto_print_preferences where store_id=p_store),true);
end $$;
create or replace function public.pitacco_set_auto_print(p_store uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) or p_enabled is null then raise exception 'Sem permissão ou configuração inválida' using errcode='42501'; end if;
 if not exists(select 1 from public.stores where id=p_store) then raise exception 'Loja não encontrada'; end if;
 insert into pitacco_private.auto_print_preferences as p(store_id,enabled,enabled_since)
 values(p_store,p_enabled,null)
 on conflict(store_id) do update set enabled=excluded.enabled,enabled_since=case when excluded.enabled and not p.enabled then clock_timestamp() else p.enabled_since end,updated_at=clock_timestamp()
 where p.enabled is distinct from excluded.enabled;
end $$;
revoke all on function public.pitacco_auto_print_status(uuid),public.pitacco_set_auto_print(uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_auto_print_status(uuid),public.pitacco_set_auto_print(uuid,boolean) to authenticated;
create or replace function pitacco_private.prevent_disabled_auto_print()
returns trigger language plpgsql security definer set search_path='' as $$
declare pref pitacco_private.auto_print_preferences%rowtype; accepted timestamptz;
begin
 if new.request_id is distinct from '00000000-0000-0000-0000-000000000000'::uuid then return new; end if;
 select * into pref from pitacco_private.auto_print_preferences where store_id=new.store_id;
 if not found then return new; end if;
 if not pref.enabled then return null; end if;
 if pref.enabled_since is not null then
  select accepted_at into accepted from public.orders where id=new.order_id and store_id=new.store_id;
  if accepted is null or accepted<pref.enabled_since then return null; end if;
 end if;
 return new;
end $$;
revoke all on function pitacco_private.prevent_disabled_auto_print() from public,anon,authenticated;
drop trigger if exists pitacco_prevent_disabled_auto_print on public.print_jobs;
create trigger pitacco_prevent_disabled_auto_print before insert on public.print_jobs for each row execute function pitacco_private.prevent_disabled_auto_print();
notify pgrst, 'reload schema';