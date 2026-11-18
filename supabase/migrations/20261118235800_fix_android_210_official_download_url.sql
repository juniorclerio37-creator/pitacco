-- Correct the GitHub release tag for the VERIFIED signed 2.0.10 APK.
-- The previous catalog migration renamed the version before replacing the tag.
update public.pitacco_app_releases
set external_download_url='https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.10-89f809286b58/Pitacco-Entregador-2.0.10.apk'
where app='android' and channel='stable' and version='2.0.10'
  and sha256='c794c3008c853b442b2cbfe76567bf4cbbe657d6afb54da854cb8954fc35d85f'
  and external_download_url is distinct from 'https://github.com/juniorclerio37-creator/pitacco/releases/download/pitacco-entregador-v2.0.10-89f809286b58/Pitacco-Entregador-2.0.10.apk';