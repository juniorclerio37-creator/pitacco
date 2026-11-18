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

-- An externally hosted release is registered only after its GitHub Actions
-- signature verification and SHA-256 evidence have been inspected. The single
-- official 2.0.6 release is registered through a separate audited data action;
-- do not seed an Android release in every fresh CI test database.
notify pgrst,'reload schema';
