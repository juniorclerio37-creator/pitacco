-- Distribuir o APK oficial mais recente sem reconstruir nem reenviar o binário.
-- Metadados verificados no GitHub Release oficial:
-- pitacco-entregador-v2.0.16-be032d7a357c / Pitacco-Entregador-2.0.16.apk
-- sha256 f90a65931dc0a84b9e38424f90cb8c761dc37831ac1093be70f63c42d517fd38
-- tamanho 2824019 bytes; ativo publicado em 2026-11-24T01:11:25Z.
do $publish$
declare
 v_actor uuid;
 v_release uuid;
 v_old record;
 v_url constant text:='https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.16-be032d7a357c/Pitacco-Entregador-2.0.16.apk';
 v_sha constant text:='f90a65931dc0a84b9e38424f90cb8c761dc37831ac1093be70f63c42d517fd38';
 v_newer text;
begin
 perform pg_advisory_xact_lock(hashtextextended('pitacco-release:android:stable',0));
 select user_id into v_actor from pitacco_private.platform_owner order by user_id limit 1;
 if v_actor is null then
  -- Instalações de CI não têm proprietário/segredos APK: nunca publicar
  -- dados fictícios em bancos limpos.
  return;
 end if;
 select version into v_newer from public.pitacco_app_releases
  where app='android' and channel='stable' and state='published'
    and string_to_array(version,'.')::int[] > array[2,0,15] limit 1;
 if found then raise notice 'APK mais recente já publicado: %, não regredir',v_newer; return; end if;
 select id into v_release from public.pitacco_app_releases
  where app='android' and channel='stable' and version='2.0.16'
  for update;
 if v_release is not null then
  if not exists (select 1 from public.pitacco_app_releases
   where id=v_release and sha256=v_sha and size_bytes=2824019
    and filename='Pitacco-Entregador-2.0.16.apk'
    and distribution_source='github_official' and external_download_url=v_url)
  then raise exception 'Já existe 2.0.16 com dados diferentes. Não substituir sem revisão'; end if;
  if exists(select 1 from public.pitacco_app_releases where id=v_release and state='published') then return;end if;
 end if;
 for v_old in
  update public.pitacco_app_releases set state='withdrawn',recommended=false
   where app='android' and channel='stable' and state='published' returning id
 loop
  insert into public.pitacco_app_release_audit(release_id,actor,action)
   values(v_old.id,v_actor,'replaced');
 end loop;
 if v_release is null then
  insert into public.pitacco_app_releases(
   app,channel,version,filename,notes,requirements,recommended,
   sha256,size_bytes,state,verified_at,published_at,distribution_source,external_download_url
  ) values(
   'android','stable','2.0.16','Pitacco-Entregador-2.0.16.apk',
   'APK oficial assinado do Pitacco Entregador v2.0.16. Mantém o aplicativo Android existente e permissões nativas de localização e notificações.',
   'Android 8 ou superior. Para notificações em segundo plano, autorize localização e notificações e mantenha as permissões do sistema.',
   true,v_sha,2824019,'published','2026-11-24T01:11:25Z'::timestamptz,now(),
   'github_official',v_url
  ) returning id into v_release;
  insert into public.pitacco_app_release_audit(release_id,actor,action)
    values(v_release,v_actor,'verified'),(v_release,v_actor,'published');
 else
  update public.pitacco_app_releases
   set state='published',recommended=true,published_at=now(),
       verified_at=coalesce(verified_at,'2026-11-24T01:11:25Z'::timestamptz)
   where id=v_release;
  insert into public.pitacco_app_release_audit(release_id,actor,action)
    values(v_release,v_actor,'published');
 end if;
end $publish$;
