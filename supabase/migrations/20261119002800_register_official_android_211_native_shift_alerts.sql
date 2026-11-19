-- Official signed update of the EXISTING Pitacco Entregador application.
-- Keep prior versions available in historical catalog but recommend only 2.0.11.
do $body$
declare v_owner uuid;v_old uuid;v_new uuid;
begin
 select user_id into v_owner from pitacco_private.platform_owner order by user_id limit 1;
 if v_owner is null then return;end if; -- isolated CI database has no owner
 if exists(select 1 from public.pitacco_app_releases where app='android'
   and channel='stable' and version='2.0.11' and state='published') then return;end if;
 for v_old in update public.pitacco_app_releases set state='withdrawn',recommended=false
  where app='android' and channel='stable' and state='published' returning id
 loop
  insert into public.pitacco_app_release_audit(release_id,actor,action)
  values(v_old,v_owner,'withdrawn');
 end loop;
 insert into public.pitacco_app_releases(
  app,channel,version,filename,notes,requirements,recommended,sha256,size_bytes,
  state,verified_at,published_at,distribution_source,external_download_url)
 values('android','stable','2.0.11','Pitacco-Entregador-2.0.11.apk',
  'Atualização do Pitacco Entregador existente. Novas entregas acionam a notificação e sino + voz nativos durante o plantão mesmo com a interface em segundo plano, usando o serviço GPS autorizado. Preserva Firebase e cadastro.',
  'Android 8 ou superior. Ative localização precisa, notificações e GPS durante o plantão. Com o app em segundo plano, o serviço nativo pode alertar enquanto estiver em execução. Após encerramento forçado, é necessário configurar o envio Firebase no servidor e registrar o aparelho; o Android pode restringir execução por bateria.',
  true,'67324ce6d9f82ba7bb9e8d6fb24ba296066e8ed24f2bc6bc6484fdc8963b6e17',2318731,'published',
  '2026-11-19T00:27:15Z'::timestamptz,'2026-11-19T00:27:15Z'::timestamptz,
  'github_official','https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.11-75012400ff84/Pitacco-Entregador-2.0.11.apk') returning id into v_new;
 insert into public.pitacco_app_release_audit(release_id,actor,action)
 select v_new,v_owner,a.action from (values('draft'),('verified'),('published')) a(action);
end;$body$;