-- Publicação de aparência em operação única.
-- O lojista escolhe "Salvar e publicar"; o banco salva e publica na
-- MESMA transação, evitando rascunho intermediário por falha de rede.
create or replace function public.pitacco_storefront_save_publish(
 p_store uuid,
 p_design jsonb,
 p_expected_draft integer,
 p_expected_published integer
) returns jsonb
language plpgsql
security definer
set search_path=''
as $studio$
declare
 current_design public.pitacco_storefront_designs%rowtype;
 next_draft integer;
 next_published integer;
 timestamp_published timestamptz:=now();
begin
 if auth.uid() is null or not public.is_store_manager(p_store) then
  raise exception 'Somente o gestor pode salvar e publicar a aparência da loja' using errcode='42501';
 end if;
 perform pitacco_private.validate_storefront_design(p_store,p_design);

 insert into public.pitacco_storefront_designs(store_id,draft)
 values (p_store,pitacco_private.storefront_design_default(p_store))
 on conflict(store_id) do nothing;

 select * into current_design
 from public.pitacco_storefront_designs
 where store_id=p_store for update;

 if current_design.draft_version is distinct from p_expected_draft
    or current_design.published_version is distinct from p_expected_published then
  raise exception 'A aparência foi alterada em outra aba ou dispositivo. Recarregue antes de publicar';
 end if;

 next_draft:=current_design.draft_version+1;
 next_published:=current_design.published_version+1;

 insert into public.pitacco_storefront_design_versions
  (store_id,version,snapshot,published_by,created_at)
 values (p_store,next_published,p_design,auth.uid(),timestamp_published);

 update public.pitacco_storefront_designs
 set draft=p_design,
     published=p_design,
     draft_version=next_draft,
     published_version=next_published,
     published_at=timestamp_published,
     updated_at=timestamp_published
 where store_id=p_store;

 return jsonb_build_object(
   'saved',true,
   'published',true,
   'draft_version',next_draft,
   'published_version',next_published,
   'published_at',timestamp_published
 );
end $studio$;
revoke all on function public.pitacco_storefront_save_publish(uuid,jsonb,integer,integer)
 from public,anon,authenticated;
grant execute on function public.pitacco_storefront_save_publish(uuid,jsonb,integer,integer)
 to authenticated;
