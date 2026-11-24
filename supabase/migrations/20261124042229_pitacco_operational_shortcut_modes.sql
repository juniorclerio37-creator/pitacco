create or replace function public.pitacco_set_global_acceptance_mode(p_store uuid,p_automatic boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) or p_automatic is null then raise exception 'Sem permissão' using errcode='42501'; end if;
 if not exists(select 1 from public.stores where id=p_store) then raise exception 'Loja não encontrada'; end if;
 insert into public.acceptance_settings(store_id,source,mode,enabled) values(p_store,'proprio',case when p_automatic then 'automatic' else 'manual' end,true) on conflict(store_id,source) do nothing;
 update public.acceptance_settings set mode=case when p_automatic then 'automatic' else 'manual' end where store_id=p_store and enabled and source in ('proprio','ifood','99food','keeta');
end $$;
create or replace function public.pitacco_set_auto_dispatch(p_store uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_store_manager(p_store) or p_enabled is null then raise exception 'Sem permissão' using errcode='42501'; end if;
 update public.stores set dispatch_mode=case when not p_enabled then 'manual' when dispatch_mode='misto' then 'misto' else 'automatico' end where id=p_store;
 if not found then raise exception 'Loja não encontrada';end if;
end $$;
revoke all on function public.pitacco_set_global_acceptance_mode(uuid,boolean),public.pitacco_set_auto_dispatch(uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_set_global_acceptance_mode(uuid,boolean),public.pitacco_set_auto_dispatch(uuid,boolean) to authenticated;
notify pgrst,'reload schema';