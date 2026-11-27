begin;
create or replace function public.pitacco_switch_print_device(p_store uuid,p_device uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_old uuid;v_pending integer;
begin
 if not public.is_store_manager(p_store) or p_device is null then raise exception 'Sem permissao'; end if;
 perform 1 from public.stores where id=p_store for update;
 select device_id into v_old from public.print_devices where store_id=p_store;
 if v_old=p_device then return 'already_bound'; end if;
 if v_old is not null then
  select count(*) into v_pending from public.print_jobs
  where store_id=p_store and device_id=v_old and state in ('claimed','saved','printing','uncertain');
  if v_pending>0 then raise exception 'Existem % trabalhos pendentes ou incertos no computador anterior. Resolva antes de transferir.',v_pending;end if;
 end if;
 insert into public.print_devices(store_id,device_id,bound_by,bound_at)
 values(p_store,p_device,auth.uid(),now())
 on conflict(store_id) do update set device_id=excluded.device_id,bound_by=excluded.bound_by,bound_at=excluded.bound_at;
 return case when v_old is null then 'bound' else 'switched' end;
end $$;
create or replace function public.pitacco_unbind_print_device(p_store uuid,p_device uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_store_manager(p_store) then raise exception 'Sem permissao';end if;
 perform 1 from public.stores where id=p_store for update;
 if exists(select 1 from public.print_jobs where store_id=p_store and device_id=p_device and state in ('claimed','saved','printing','uncertain')) then raise exception 'Ha impressões pendentes; resolva antes de desvincular';end if;
 delete from public.print_devices where store_id=p_store and device_id=p_device;
end $$;
revoke all on function public.pitacco_switch_print_device(uuid,uuid) from public,anon;
revoke all on function public.pitacco_unbind_print_device(uuid,uuid) from public,anon;
grant execute on function public.pitacco_switch_print_device(uuid,uuid) to authenticated;
grant execute on function public.pitacco_unbind_print_device(uuid,uuid) to authenticated;
commit;