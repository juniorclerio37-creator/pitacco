const repo='juniorclerio37-creator/pitacco';
const base='https://github.com/'+repo+'/releases/download/';
const validVersion=v=>/^[0-9]+[.][0-9]+[.][0-9]+$/.test(v||'');
export function officialCatalogRows(releases){
 if(!Array.isArray(releases))return [];
 return releases.filter(r=>!r.draft&&!r.prerelease).flatMap(r=>{
  const windows=/^pitacco-windows-[a-f0-9]{12}$/.test(r.tag_name||'');const android=/^pitacco-entregador-v([0-9]+[.][0-9]+[.][0-9]+)-[a-f0-9]{12}$/.exec(r.tag_name||'');
  if(!windows&&!android)return [];
  const filename=windows?'Pitacco-Windows-Setup.exe':'Pitacco-Entregador-'+android[1]+'.apk';
  const asset=r.assets?.find(a=>a.name===filename&&a.size>0&&a.browser_download_url===base+r.tag_name+'/'+filename);if(!asset)return [];
  const manifest=windows?r.assets?.find(a=>a.name==='latest.json'&&a.browser_download_url===base+r.tag_name+'/latest.json'):null;
  return [{id:r.tag_name,app:windows?'windows':'android',version:android?.[1]||null,published_at:r.published_at||r.created_at,url:asset.browser_download_url,size_bytes:asset.size,manifest:manifest?.browser_download_url||null,notes:String(r.body||'').slice(0,1600)}];
 }).sort((a,b)=>(Date.parse(b.published_at)||0)-(Date.parse(a.published_at)||0)).slice(0,30);
}
export async function handleControlReleases(request,env,callSupabase){
 const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store, private','Vary':'Authorization','X-Content-Type-Options':'nosniff'}});
 if(request.method!=='GET')return json({error:'Método não permitido.'},405);
 const token=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'')?.[1];if(!token)return json({error:'Sessão necessária.'},401);
 try{
  const permission=await callSupabase(env,'/rest/v1/rpc/pitacco_control_access',token,{body:{}});if(!permission.ok)return json({error:permission.status===401||permission.status===403?'Acesso administrativo não autorizado.':'A verificação de permissões não respondeu.'},permission.status===401||permission.status===403?403:503);
  const access=await permission.json();if(!access.allowed||!access.owner&&!access.modules?.includes('health'))return json({error:'Sem permissão para consultar versões.'},403);
  const response=await fetch('https://api.github.com/repos/'+repo+'/releases?per_page=100',{headers:{Accept:'application/vnd.github+json','User-Agent':'Pitacco-Control-Center'},signal:AbortSignal.timeout(7000)});if(!response.ok)throw Error();
  const rows=officialCatalogRows(await response.json());const latestWindows=rows.find(r=>r.app==='windows');
  if(latestWindows?.manifest){try{const m=await fetch(latestWindows.manifest,{signal:AbortSignal.timeout(7000),headers:{'User-Agent':'Pitacco-Control-Center'}});if(m.ok){const text=await m.text();if(text.length<15000){const data=JSON.parse(text);if(validVersion(data.version)&&data.platforms?.['windows-x86_64']?.url===latestWindows.url)latestWindows.version=data.version;}}}catch{}}
  return json({rows:rows.map(({manifest,...r})=>r),observed_at:new Date().toISOString(),source:'GitHub Releases oficial · metadados publicados pelo pipeline'});
 }catch{return json({error:'Não foi possível consultar o catálogo oficial de instaladores.'},503)}
}
