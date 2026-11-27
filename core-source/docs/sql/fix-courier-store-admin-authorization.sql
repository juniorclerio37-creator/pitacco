-- Pitacco Motoboys: autorização exclusiva de backend para gestão de entregadores.
-- O administrador geral gerencia todas as lojas existentes; o gestor/lojista apenas sua loja.
-- Nunca confiar no storeId enviado pelo navegador sem esta verificação.
create or replace function public.pitacco_can_manage_courier_store(p_actor uuid, p_store uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_actor is not null and p_store is not null and exists (
    select 1 from public.stores s
    where s.id = p_store
      and (
        exists (select 1 from pitacco_private.platform_owner po where po.user_id = p_actor)
        or exists (
          select 1 from public.store_members sm
          where sm.store_id = s.id
            and sm.user_id = p_actor
            and sm.role in ('gestor', 'lojista')
        )
      )
  );
$function$;
revoke all on function public.pitacco_can_manage_courier_store(uuid,uuid) from public, anon, authenticated;
grant execute on function public.pitacco_can_manage_courier_store(uuid,uuid) to service_role;
