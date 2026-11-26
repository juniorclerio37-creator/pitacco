-- Reproduz a função operacional já instalada em produção para bancos novos e CI.
CREATE OR REPLACE FUNCTION public.pitacco_update_store_identity(p_store_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_logo text;
begin
 if auth.uid() is null or not (public.is_admin() or public.pitacco_can_manage_store(p_store_id)) then
  raise exception 'Sem permissão para editar esta loja';
 end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(btrim(coalesce(p_data->>'name','')))<3 then raise exception 'Nome da loja inválido';end if;
 if length(p_data->>'name')>100 then raise exception 'Nome muito longo';end if;
 v_logo:=nullif(p_data->>'logo_path','');
 if v_logo is not null and (left(v_logo,length('stores/'||p_store_id::text||'/')) <> 'stores/'||p_store_id::text||'/' or length(v_logo)>300) then
  raise exception 'Caminho de imagem inválido';
 end if;
 update public.stores set
 name=btrim(p_data->>'name'),
 description=nullif(left(p_data->>'description',1500),''),
 phone=nullif(left(p_data->>'phone',180),''),
 address=nullif(left(p_data->>'address',180),''),
 address_number=nullif(left(p_data->>'address_number',180),''),
 neighborhood=nullif(left(p_data->>'neighborhood',180),''),
 city=nullif(left(p_data->>'city',180),''),
 state=nullif(left(p_data->>'state',180),''),
 postal_code=nullif(left(p_data->>'postal_code',180),''),
 logo_path=case when p_data ? 'logo_path' then v_logo else logo_path end,
 updated_at=now() where id=p_store_id;
 if not found then raise exception 'Loja não encontrada';end if;
end $function$;
revoke all on function public.pitacco_update_store_identity(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.pitacco_update_store_identity(uuid,jsonb) to authenticated,service_role;
