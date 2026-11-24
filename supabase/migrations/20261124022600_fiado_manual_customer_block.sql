create or replace function public.pitacco_fiado_set_customer_enabled(p_store uuid,p_customer uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $fiado$
declare old_enabled boolean;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente o gestor pode bloquear ou liberar o fiado' using errcode='42501';
 end if;
 if p_enabled is null then raise exception 'Informe a autorização' using errcode='22023'; end if;
 select c.enabled into old_enabled from public.pitacco_fiado_customers c
 where c.store_id=p_store and c.id=p_customer for update;
 if not found then raise exception 'Cliente não cadastrado nesta loja' using errcode='42501'; end if;
 if old_enabled is distinct from p_enabled then
  update public.pitacco_fiado_customers set enabled=p_enabled,updated_at=now()
   where store_id=p_store and id=p_customer;
  if not p_enabled then
   delete from pitacco_private.fiado_pin_verifications where store_id=p_store and customer_id=p_customer and used_at is null;
  end if;
  insert into public.operation_audit(store_id,actor,action,details)
  values(p_store,auth.uid(),'fiado_customer_authorization_changed',
   jsonb_build_object('customer',p_customer,'enabled',p_enabled,'previous_enabled',old_enabled));
 end if;
 return p_enabled;
end $fiado$;
revoke all on function public.pitacco_fiado_set_customer_enabled(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.pitacco_fiado_set_customer_enabled(uuid,uuid,boolean) to authenticated;
