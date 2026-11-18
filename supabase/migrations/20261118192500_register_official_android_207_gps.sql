-- Register the officially signed and verified courier Android v2.0.7.
-- The unique published(app,channel) index requires withdrawing the prior version.
-- This does not revoke already installed copies or remove the historical release.
do $body$
declare
  v_owner uuid;
  v_release uuid;
  v_old uuid;
begin
  select user_id into v_owner from pitacco_private.platform_owner order by user_id limit 1;
  if v_owner is null then
    raise exception 'Platform owner must exist before registering official Android release';
  end if;
  if exists(select 1 from public.pitacco_app_releases
            where app='android' and channel='stable' and version='2.0.7' and state='published') then
    return;
  end if;
  for v_old in
    update public.pitacco_app_releases set state='withdrawn',recommended=false
      where app='android' and channel='stable' and state='published'
    returning id
  loop
    insert into public.pitacco_app_release_audit(release_id,actor,action)
      values(v_old,v_owner,'withdrawn');
  end loop;
  insert into public.pitacco_app_releases(
    app,channel,version,filename,notes,requirements,recommended,sha256,
    size_bytes,state,verified_at,published_at,distribution_source,external_download_url
  ) values(
    'android','stable','2.0.7','Pitacco-Entregador-2.0.7.apk',
    'APK oficial assinado e validado pelo GitHub Actions #44378768449. GPS autenticado com precisão e atualização da localização durante o plantão com o aplicativo aberto. Mantém notificações e fluxo de pedidos.',
    'Android 8.0 ou superior. Autorize a localização precisa e as notificações. O GPS pode pausar em segundo plano nesta versão; bateria e Não Perturbe podem restringir alertas.',
    true,'4c58b8752fa1ad3d445810d1039e0271f5a46b0c3437e7e798b8e7b6082b691e',
    2314635,'published','2026-11-18T19:18:10Z'::timestamptz,
    '2026-11-18T19:18:10Z'::timestamptz,
    'github_official',
    'https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.7-0d9ef6f30f41/Pitacco-Entregador-2.0.7.apk'
  ) returning id into v_release;
  insert into public.pitacco_app_release_audit(release_id,actor,action)
    select v_release,v_owner,action from (values ('draft'),('verified'),('published')) a(action);
end;
$body$;