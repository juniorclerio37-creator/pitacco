-- Upgrade the SAME official Pitacco Entregador application, preserving earlier releases.
-- Official signed APK v2.0.9 verified in GitHub Actions, same applicationId and certificate.
do $migration$
declare
 v_owner uuid;
 v_old uuid;
 v_new uuid;
begin
 select user_id into v_owner from pitacco_private.platform_owner order by user_id limit 1;
 if v_owner is null then
   raise exception 'Proprietário do Pitacco não localizado; nenhum catálogo alterado';
 end if;
 if exists(select 1 from public.pitacco_app_releases
           where app='android' and channel='stable' and version='2.0.9' and state='published') then
   return;
 end if;
 for v_old in update public.pitacco_app_releases
   set state='withdrawn',recommended=false
   where app='android' and channel='stable' and state='published'
   returning id
 loop
   insert into public.pitacco_app_release_audit(release_id,actor,action)
   values(v_old,v_owner,'withdrawn');
 end loop;
 insert into public.pitacco_app_releases (
   app,channel,version,filename,notes,requirements,recommended,
   sha256,size_bytes,state,verified_at,published_at,
   distribution_source,external_download_url
 ) values (
   'android','stable','2.0.9','Pitacco-Entregador-2.0.9.apk',
   'Atualização do aplicativo original. Solicita a permissão nativa do Android para GPS preciso e apresenta diagnóstico de registro Firebase na tela de entregas. Preserva identidade, cadastro e alertas de sino + voz.',
   'Android 8 ou superior; conceda localização precisa e notificações. Alertas com o aplicativo em segundo plano exigem dispositivo Firebase registrado e envio habilitado no servidor. GPS contínuo em segundo plano não está implementado.',
   true,'b0a8ed7ae982a0378428ca64b60b9730381e2ba70c31983818df4f58d8ad98ce',
   2314635,'published','2026-11-18T23:21:44Z'::timestamptz,
   '2026-11-18T23:21:44Z'::timestamptz,'github_official',
   'https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.9-4041a29cefed/Pitacco-Entregador-2.0.9.apk'
 ) returning id into v_new;
 insert into public.pitacco_app_release_audit(release_id,actor,action)
 select v_new,v_owner,actions.action from (values('draft'),('verified'),('published')) actions(action);
end;
$migration$;