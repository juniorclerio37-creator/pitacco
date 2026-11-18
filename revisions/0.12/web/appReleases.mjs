export const RELEASE_BUCKET = 'pitacco-installers';
export const RELEASE_LIMIT = 50 * 1024 * 1024;
export const COURIER_APP_URL = 'https://entregador.pitacco.com.br/';
export const releasePath = release => release.id + '/' + release.filename;
export const releaseDate = value => value ? new Intl.DateTimeFormat('pt-BR', {
  dateStyle:'medium',timeZone:'America/Sao_Paulo'
}).format(new Date(value)) : '';
export async function fileSha256(file) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return Array.from(digest, byte=>byte.toString(16).padStart(2,'0')).join('');
}
// Only official GitHub APK assets can be linked from the release catalog.
// Keep existing private bucket links for manually uploaded Windows/Android files.
export function officialCourierApkUrl(release) {
  if(release?.distribution_source!=='github_official' ||
     release.app!=='android' || release.channel!=='stable' ||
     !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(String(release.version||'')) ||
     release.filename!=='Pitacco-Entregador-'+release.version+'.apk')return null;
  const url=String(release.external_download_url||'');
  const match=url.match(/^https:\/\/github[.]com\/juniorclerio37-creator\/pitacco\/releases\/download\/pitacco-entregador-v([0-9]+[.][0-9]+[.][0-9]+)-[0-9a-f]{12}\/Pitacco-Entregador-([0-9]+[.][0-9]+[.][0-9]+)[.]apk$/);
  if(!match || match[1]!==release.version || match[2]!==release.version)return null;
  return url;
}
export async function downloadRelease(client, release) {
  let url;
  if(release.distribution_source==='github_official') {
    url=officialCourierApkUrl(release);
    if(!url)throw Error('Link do APK oficial não corresponde à versão assinada.');
  } else {
    const {data,error}=await client.storage.from(RELEASE_BUCKET).createSignedUrl(releasePath(release),60,{download:release.filename});
    if(error || !data?.signedUrl)throw Error('Arquivo indisponível. Atualize a lista de versões.');
    url=data.signedUrl;
  }
  const link=document.createElement('a');
  link.href=url;
  link.download=release.filename;
  link.rel='noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
}


const WINDOWS_PUBLIC_RELEASES = 'https://api.github.com/repos/juniorclerio37-creator/pitacco/releases?per_page=20';
const WINDOWS_ASSET = 'Pitacco-Windows-Setup.exe';

// Secondary distribution via a public GitHub release when no Super Admin
// release has been uploaded to the original private download bucket.
export async function discoverPublicWindowsInstaller(request = fetch) {
  const response = await request(WINDOWS_PUBLIC_RELEASES, {
    headers:{Accept:'application/vnd.github+json'}
  });
  if(!response.ok)throw Error('Não foi possível consultar o instalador Windows.');
  const entries = await response.json();
  if(!Array.isArray(entries))throw Error('Resposta inesperada da central de versões.');
  for(const release of entries) {
    if(release.draft || release.prerelease || !/^pitacco-windows-[a-f0-9]{12}$/.test(release.tag_name||''))continue;
    const asset = release.assets?.find(item=>item.name===WINDOWS_ASSET);
    if(!asset?.browser_download_url || asset.size<=0)continue;
    const url = asset.browser_download_url;
    if(!url.startsWith('https://github.com/juniorclerio37-creator/pitacco/releases/download/')
      || !url.endsWith('/'+WINDOWS_ASSET))continue;
    return {url,version:'0.12.2',published_at:release.published_at||release.created_at};
  }
  return null;
}
export function downloadPublicWindowsInstaller(installer) {
  const url=installer?.url;
  if(typeof url!=='string'
    || !url.startsWith('https://github.com/juniorclerio37-creator/pitacco/releases/download/')
    || !url.endsWith('/'+WINDOWS_ASSET)) {
    throw Error('Instalador Windows indisponível.');
  }
  const link=document.createElement('a');
  link.href=url;
  link.download=WINDOWS_ASSET;
  // GitHub serves the release asset as an attachment: clicking the button starts
  // a download without opening GitHub in another tab or displaying its URL.
  link.rel='noopener noreferrer';
  document.body.append(link);link.click();link.remove();
}
