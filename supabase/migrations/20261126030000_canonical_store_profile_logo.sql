-- A identidade da loja é independente das revisões de aparência do cardápio.
-- A migração anterior já copiou os logotipos publicados para stores.logo_path.
drop trigger if exists pitacco_sync_published_store_logo on public.pitacco_storefront_designs;

create or replace function pitacco_private.published_store_logo_path(p_store uuid)
returns text language sql stable set search_path='' as $$
 select case when s.logo_path ~ ('^stores/'||s.id::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$')
 then s.logo_path end from public.stores s where s.id=p_store;
$$;
revoke all on function pitacco_private.published_store_logo_path(uuid) from public,anon,authenticated;

-- Templates antigos, rascunhos e restauração de revisões não alteram a marca.
create function pitacco_private.keep_store_identity_in_design() returns trigger
language plpgsql security definer set search_path='' as $$
declare logo text:=coalesce(pitacco_private.published_store_logo_path(new.store_id),'');
begin
 new.draft:=jsonb_set(new.draft,'{logo_path}',to_jsonb(logo),true);
 if new.published is not null then
  new.published:=jsonb_set(new.published,'{logo_path}',to_jsonb(logo),true);
 end if;
 return new;
end $$;
revoke all on function pitacco_private.keep_store_identity_in_design() from public,anon,authenticated;
create trigger pitacco_keep_store_identity_in_design
before insert or update of draft,published on public.pitacco_storefront_designs
for each row execute function pitacco_private.keep_store_identity_in_design();

-- Preserve todos os outros campos e não publique rascunhos de aparência.
update public.pitacco_storefront_designs d set draft=d.draft,published=d.published
where d.draft->>'logo_path' is distinct from coalesce(pitacco_private.published_store_logo_path(d.store_id),'')
or (d.published is not null and d.published->>'logo_path' is distinct from coalesce(pitacco_private.published_store_logo_path(d.store_id),''));

create function public.pitacco_save_store_logo(p_store uuid,p_logo_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_can_manage_store(p_store) then
  raise exception 'Sem permissão para alterar o logotipo' using errcode='42501';
 end if;
 if p_logo_path is null or p_logo_path !~ ('^stores/'||p_store::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$') then
  raise exception 'Caminho de logotipo inválido' using errcode='22023';
 end if;
 update public.stores set logo_path=p_logo_path where id=p_store;
 if not found then raise exception 'Loja não encontrada';end if;
 update public.pitacco_storefront_designs set draft=draft,published=published,
  draft_version=draft_version+1,updated_at=now() where store_id=p_store;
 return jsonb_build_object('saved',true,'logo_path',p_logo_path);
end $$;
revoke all on function public.pitacco_save_store_logo(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_save_store_logo(uuid,text) to authenticated;
notify pgrst,'reload schema';
