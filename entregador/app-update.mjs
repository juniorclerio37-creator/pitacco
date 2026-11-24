// Atualizações oficiais do Pitacco Entregador. Nenhum APK de outro domínio
// pode ser instalado pela ponte nativa.
const REPO='juniorclerio37-creator/pitacco';
const API='https://api.github.com/repos/'+REPO+'/releases?per_page=100';
const APK_URL=/^https:\/\/github[.]com\/juniorclerio37-creator\/pitacco\/releases\/download\/pitacco-entregador-v([0-9]+[.][0-9]+[.][0-9]+)-[0-9a-f]{12}\/Pitacco-Entregador-([0-9]+[.][0-9]+[.][0-9]+)[.]apk$/;
const VERSION=/^[0-9]+[.][0-9]+[.][0-9]+$/;
const SHA=/^[0-9a-f]{64}$/;

export function compareCourierVersions(left,right) {
 if(!VERSION.test(String(left||''))||!VERSION.test(String(right||'')))return null;
 const a=left.split('.').map(Number),b=right.split('.').map(Number);
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;
 return 0;
}

export function verifiedCourierApk(candidate) {
 if(!candidate||typeof candidate!=='object')return null;
 const version=String(candidate.version||'');
 const url=String(candidate.url||'');
 const filename=String(candidate.filename||'');
 const sha256=String(candidate.sha256||'').toLowerCase();
 const match=url.match(APK_URL);
 if(!VERSION.test(version)||!match||match[1]!==version||match[2]!==version||
    filename!=='Pitacco-Entregador-'+version+'.apk'||!SHA.test(sha256))return null;
 return {version,url,filename,sha256};
}

export function latestOfficialCourierRelease(releases) {
 if(!Array.isArray(releases))return null;
 const eligible=[];
 for(const release of releases){
  if(release.draft||release.prerelease||typeof release.tag_name!=='string')continue;
  const matched=release.tag_name.match(/^pitacco-entregador-v([0-9]+[.][0-9]+[.][0-9]+)-[0-9a-f]{12}$/);
  if(!matched||!release.published_at)continue;
  const version=matched[1];
  const asset=(release.assets||[]).find(a=>a.name==='Pitacco-Entregador-'+version+'.apk'&&
   a.size>100000&&a.size<=50*1024*1024&&typeof a.digest==='string'&&
   /^sha256:[0-9a-f]{64}$/.test(a.digest));
  if(!asset)continue;
  const item=verifiedCourierApk({version,url:asset.browser_download_url,filename:asset.name,sha256:asset.digest.slice(7)});
  if(item)eligible.push({...item,published_at:release.published_at});
 }
 eligible.sort((a,b)=>compareCourierVersions(b.version,a.version)||
  Date.parse(b.published_at)-Date.parse(a.published_at));
 return eligible[0]||null;
}
export async function discoverCourierRelease(request=fetch) {
 const response=await request(API,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
 if(!response?.ok)throw Error('Não foi possível consultar as atualizações oficiais.');
 const latest=latestOfficialCourierRelease(await response.json());
 if(!latest)throw Error('Nenhuma versão oficial verificada disponível.');
 return latest;
}

export async function discoverCourierReleaseWithFallback(request=fetch,rpc=null) {
 try{return await discoverCourierRelease(request);}
 catch(error){
  if(!rpc)throw error;
  const {data, error:rpcError}=await rpc('pitacco_public_courier_apk');
  const latest=!rpcError&&verifiedCourierApk(data);
  if(!latest)throw error;
  return latest;
 }
}
