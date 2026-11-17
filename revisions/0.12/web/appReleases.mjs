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
export async function downloadRelease(client, release) {
  const {data,error} = await client.storage.from(RELEASE_BUCKET).createSignedUrl(releasePath(release),60,{download:release.filename});
  if(error || !data?.signedUrl) throw Error('Arquivo indisponível. Atualize a lista de versões.');
  const link = document.createElement('a');
  link.href = data.signedUrl;
  document.body.append(link);
  link.click();
  link.remove();
}
