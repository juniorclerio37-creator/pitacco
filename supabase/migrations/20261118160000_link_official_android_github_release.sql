-- Link one already signed, published Pitacco Android release into the
-- existing Super Admin catalog. The APK stays on the official GitHub Release,
-- not in the private Supabase bucket. No private signing material is copied.
-- Source evidence: workflow run #42, official release asset SHA-256.
alter table public.pitacco_app_releases
  add column if not exists distribution_source text not null default 'storage'
    check (distribution_source in ('storage','github_official'));
alter table public.pitacco_app_releases
  add column if not exists external_download_url text;

alter table public.pitacco_app_releases
  add constraint pitacco_app_release_official_external_url_check check (
   (distribution_source='storage' and external_download_url is null)
   or
   (distribution_source='github_official'
    and app='android'
    and channel='stable'
    and filename='Pitacco-Entregador-'||version||'.apk'
    and external_download_url ~
      '^https://github[.]com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v[0-9]+[.][0-9]+[.][0-9]+-[a-f0-9]{12}/Pitacco-Entregador-[0-9]+[.][0-9]+[.][0-9]+[.]apk$'
    and external_download_url like
      'https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v'||version||'-%/'
      ||filename
   )
  );

-- Ensure the public app-login download can use the official source,
-- while preserving the private storage path for previous stable releases.
create or replace function public.pitacco_public_courier_apk()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'path',case when distribution_source='storage' then id::text||'/'||filename else null end,
  'url',case when distribution_source='github_official' then external_download_url else null end,
  'filename',filename,'version',version,'sha256',sha256
 )
 from public.pitacco_app_releases
 where app='android' and channel='stable'
   and state='published' and verified_at is not null
 order by published_at desc
 limit 1
$$;
revoke all on function public.pitacco_public_courier_apk() from public,anon,authenticated;
grant execute on function public.pitacco_public_courier_apk() to anon,authenticated;

-- Insert a signed stable release only if no Android stable version is
-- already published. Never silently replace a newer version.
with release as (
 insert into public.pitacco_app_releases(
  app,channel,version,filename,notes,requirements,recommended,
  sha256,size_bytes,state,verified_at,published_at,
  distribution_source,external_download_url
 )
 select
  'android','stable','2.0.6','Pitacco-Entregador-2.0.6.apk',
  'Primeira versão oficial do Pitacco Entregador, assinada e compilada com Firebase. '
  ||'Pedidos e ganhos sincronizados, alertas de entrega e acompanhamento.',
  'Android 8.0 ou superior. Permita notificações e otimize as configurações de bateria para receber avisos em segundo plano.',
  true,'577d618ac8bd8977cf3de088a3f1ee8bb5b59a5fb48909cfc6746371999f6f45',2314635,'published',
  '2026-11-18T15:40:45Z'::timestamptz,
  '2026-11-18T15:40:45Z'::timestamptz,
  'github_official','https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.6-4e5c9c2de727/Pitacco-Entregador-2.0.6.apk'
 where not exists(
  select 1 from public.pitacco_app_releases
  where app='android' and channel='stable' and state='published'
 )
 on conflict (app,channel,version) do nothing
 returning id
), owner as (
 select user_id from pitacco_private.platform_owner order by user_id limit 1
)
insert into public.pitacco_app_release_audit(release_id,actor,action)
select r.id,o.user_id,event.action
from release r cross join owner o
cross join (values ('draft'),('verified'),('published')) as event(action);
notify pgrst,'reload schema';
