-- PROPOSTA: não aplicada em produção. Validar com schema real e testes de integração.
-- Bloqueia apenas geração de novas comandas automáticas; não descarta filas existentes.
begin;
alter table public.stores add column if not exists auto_print_enabled boolean not null default true;
create or replace function public.pitacco_auto_print_status(p_store uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then raise exception 'Sem permissão'; end if;
 return (select auto_print_enabled from public.stores where id=p_store);
end $$;
create or replace function public.pitacco_set_auto_print(p_store uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) or p_enabled is null then raise exception 'Sem permissão ou configuração inválida'; end if;
 update public.stores set auto_print_enabled=p_enabled where id=p_store;
end $$;
revoke all on function public.pitacco_auto_print_status(uuid),public.pitacco_set_auto_print(uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_auto_print_status(uuid),public.pitacco_set_auto_print(uuid,boolean) to authenticated;
create or replace function pitacco_private.prevent_disabled_auto_print()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.request_id,'00000000-0000-0000-0000-000000000000'::uuid)='00000000-0000-0000-0000-000000000000'::uuid
 and exists(select 1 from public.stores where id=new.store_id and not auto_print_enabled) then
  return null;
 end if;
 return new;
end $$;
revoke all on function pitacco_private.prevent_disabled_auto_print() from public,anon,authenticated;
drop trigger if exists pitacco_prevent_disabled_auto_print on public.print_jobs;
create trigger pitacco_prevent_disabled_auto_print before insert on public.print_jobs for each row execute function pitacco_private.prevent_disabled_auto_print();
commit;
