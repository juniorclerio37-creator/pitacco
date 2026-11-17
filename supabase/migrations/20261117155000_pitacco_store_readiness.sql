-- Checklist real de prontidão para o lojista.
create or replace function public.pitacco_store_readiness(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.stores%rowtype; menu public.public_menu_settings%rowtype;
  product_count integer; checks jsonb;
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Sem acesso à loja' using errcode='42501';
 end if;
 select * into s from public.stores where id=p_store;
 if not found then raise exception 'Loja não encontrada'; end if;
 select * into menu from public.public_menu_settings where store_id=p_store;
 select count(*) into product_count from public.products where store_id=p_store and menu_active;
 checks:=jsonb_build_object(
  'identity', length(trim(coalesce(s.name,'')))>=3,
  'address',length(trim(coalesce(s.address,'')))>=3 and length(trim(coalesce(s.city,'')))>=2 and length(trim(coalesce(s.state,'')))>=2,
  'products',product_count>0,
  'payments',cardinality(coalesce(menu.payment_methods,array[]::text[]))>0,
  'fulfillment',coalesce(menu.delivery_enabled,false) or coalesce(menu.pickup_enabled,false),
  'published',coalesce(menu.enabled,false)
 );
 return jsonb_build_object('store_id',p_store,'checks',checks,'products',product_count,
  'ready',not exists(select 1 from jsonb_each_text(checks) a where a.value='false'));
end $$;
revoke all on function public.pitacco_store_readiness(uuid) from public,anon,authenticated;
grant execute on function public.pitacco_store_readiness(uuid) to authenticated;
