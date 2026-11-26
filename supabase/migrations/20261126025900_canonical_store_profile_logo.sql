
-- The store record is the sole authority for logo identity. The earlier
-- migration already copied published logos into stores.logo_path.
drop trigger if exists pitacco_sync_published_store_logo on public.pitacco_storefront_designs;
create or replace function pitacco_private.published_store_logo_path(p_store uuid)
returns text language sql stable set search_path='' as $$
 select case when s.logo_path ~ ('^stores/'||s.id::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$') then s.logo_path end
 from public.stores s where s.id=p_store
$$;
revoke all on function pitacco_private.published_store_logo_path(uuid) from public,anon,authenticated;
create or replace function pitacco_private.with_store_logo(p_store uuid,p_design jsonb)
returns jsonb language sql stable set search_path='' as $$
 select case when p_design is null then null else jsonb_set(p_design,'{logo_path}',to_jsonb(coalesce(pitacco_private.published_store_logo_path(p_store),'')),true) end
$$;
revoke all on function pitacco_private.with_store_logo(uuid,jsonb) from public,anon,authenticated;
create or replace function public.pitacco_save_store_logo(p_store uuid,p_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.pitacco_can_manage_store(p_store) then raise exception 'Sem permissão para editar esta loja' using errcode='42501';end if;
 if p_path is null or p_path !~ ('^stores/'||p_store::text||'/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$') or length(p_path)>300 then raise exception 'Caminho de imagem inválido';end if;
 update public.stores set logo_path=p_path,updated_at=now() where id=p_store;
 if not found then raise exception 'Loja não encontrada';end if;
 return jsonb_build_object('saved',true,'logo_path',p_path);
end $$;
revoke all on function public.pitacco_save_store_logo(uuid,text) from public,anon,authenticated;
grant execute on function public.pitacco_save_store_logo(uuid,text) to authenticated;
-- Keep old clients and historical snapshots compatible, but never allow a
-- draft or published template to override the logo in the store profile.
do $patch$
declare f text;
begin
 select pg_get_functiondef('pitacco_private.storefront_public_design(uuid)'::regprocedure) into f;
 if strpos(f,'jsonb_set(d.published,')=0 then raise exception 'Public design anchor missing';end if;
 execute replace(f,'jsonb_set(d.published,','jsonb_set(pitacco_private.with_store_logo(p_store,d.published),');
 select pg_get_functiondef('public.pitacco_storefront_studio_state(uuid)'::regprocedure) into f;
 if strpos(f,'''draft'',coalesce(row.draft,pitacco_private.storefront_design_default(p_store)),')=0 then raise exception 'Studio draft anchor missing';end if;
 f:=replace(f,'''draft'',coalesce(row.draft,pitacco_private.storefront_design_default(p_store)),','''draft'',pitacco_private.with_store_logo(p_store,coalesce(row.draft,pitacco_private.storefront_design_default(p_store))),');
 f:=replace(f,'''published'',row.published,','''published'',pitacco_private.with_store_logo(p_store,row.published),');
 execute f;
end $patch$;
notify pgrst,'reload schema';
