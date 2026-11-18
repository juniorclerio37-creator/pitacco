-- Official Pitacco Entregador 2.0.6 APK was verified by the actual
-- GitHub Actions workflow_dispatch run 44338105622. The official release
-- includes both SHA256-ANDROID.txt and ASSINATURA-ANDROID.txt, signed with
-- the configured Android release certificate.
-- No unsigned APK or signing material is copied into public storage.
-- On fresh CI databases without a platform owner, do not create a release
-- that would conflict with the fixture's independent publication tests.
with owner as (
 select user_id from pitacco_private.platform_owner order by user_id limit 1
),
registered as (
 insert into public.pitacco_app_releases(
  app,channel,version,filename,notes,requirements,recommended,
  sha256,size_bytes,state,verified_at,published_at,
  distribution_source,external_download_url
 )
 select
  'android','stable','2.0.6','Pitacco-Entregador-2.0.6.apk',
  'APK oficial assinado, publicado em GitHub Actions #44338105622. '
  || 'Firebase de produção, notificações de entregas, acompanhamento e ganhos.',
  'Android 8.0 ou superior. Habilite as notificações; restrições de bateria e '
  || 'Não Perturbe podem limitar alertas em segundo plano.',
  true,'577d618ac8bd8977cf3de088a3f1ee8bb5b59a5fb48909cfc6746371999f6f45',2314635,
  'published','2026-11-18T15:40:45Z'::timestamptz,
  '2026-11-18T15:40:45Z'::timestamptz,
  'github_official',
  'https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.6-4e5c9c2de727/Pitacco-Entregador-2.0.6.apk'
 from owner
 where not exists (
  select 1 from public.pitacco_app_releases
  where app='android' and channel='stable' and state='published'
 )
 on conflict (app,channel,version) do nothing
 returning id
)
insert into public.pitacco_app_release_audit(release_id,actor,action)
select registered.id,owner.user_id,event.action
from registered cross join owner
cross join (values ('draft'),('verified'),('published')) as event(action);
