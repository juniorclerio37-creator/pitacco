import React,{useEffect,useState} from 'react';
import {COURIER_APP_URL,downloadRelease,releaseDate,discoverPublicWindowsInstaller,downloadPublicWindowsInstaller} from './appReleases.mjs';
import './app-releases.css';

export default function AppDownloads({client}){
 const [releases,setReleases]=useState(null),[retry,setRetry]=useState(0);
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 const [publicWindows,setPublicWindows]=useState(null),[checkingWindows,setCheckingWindows]=useState(true);
 useEffect(()=>{
  let live=true;
  setReleases(null);setError('');
  client.from('pitacco_app_releases').select('id,app,version,filename,notes,requirements,recommended,published_at,sha256')
   .eq('state','published').eq('channel','stable').then(({data,error})=>{
    if(!live)return;
    if(error){setError('Não foi possível consultar os downloads.');setReleases([]);}
    else setReleases(data);
   });
  return()=>{live=false;};
 },[client,retry]);
 useEffect(()=>{
  let live=true;
  setCheckingWindows(true);
  discoverPublicWindowsInstaller().then(installer=>{if(live)setPublicWindows(installer)})
   .catch(()=>{if(live)setPublicWindows(null)})
   .finally(()=>{if(live)setCheckingWindows(false)});
  return()=>{live=false};
 },[retry]);
 async function downloadPublic(installer){
  try{downloadPublicWindowsInstaller(installer)}
  catch(e){setError(e.message||'Não foi possível baixar o aplicativo Windows.')}
 }
 async function download(row){
  setBusy(row.id);setError('');
  try{await downloadRelease(client,row);}
  catch(error){setError(error.message);}
  finally{setBusy('');}
 }
 async function share(){
  setError('');
  try {
   if(navigator.share)await navigator.share({title:'Pitacco Entregador',url:COURIER_APP_URL});
   else {await navigator.clipboard.writeText(COURIER_APP_URL);setShared(true);}
  }catch(error){if(error.name!=='AbortError')setError('Não foi possível compartilhar. Use o endereço exibido nesta página.');}
 }
 const [shared,setShared]=useState(false);
 return <div className="app-releases">
  {error&&<div className="panel"><p role="alert">{error}</p><button type="button" className="secondary" onClick={()=>setRetry(retry+1)}>Atualizar downloads</button></div>}
  {!releases&&<p role="status">Consultando versões oficiais…</p>}
  {[['windows','Pitacco Windows — Gestor de Pedidos','Baixar Pitacco Windows'],['android','Pitacco Entregador','Baixar para Android']].map(([app,title,action])=>{
   const row=releases?.find(release=>release.app===app);
   return <section className="panel" key={app}><h3>{title}</h3>
    {row&&<><p>Versão {row.version} · {releaseDate(row.published_at)}{row.recommended?' · Atualização recomendada':''}</p>
     {row.notes&&<p className="release-notes">{row.notes}</p>}{row.requirements&&<p>Requisitos: {row.requirements}</p>}
     <details><summary>Verificar integridade do arquivo</summary><code>{row.sha256}</code></details>
     <button type="button" disabled={!!busy} onClick={()=>void download(row)}>{busy===row.id?'Preparando download…':action}</button></>}
    {app==='windows'&&releases&&!row&&publicWindows&&<>
     <p>Versão para Windows disponível para instalação · {releaseDate(publicWindows.published_at)}</p>
     <button type="button" disabled={!!busy} onClick={()=>void downloadPublic(publicWindows)}>Baixar Pitacco Windows</button>
    </>}
    {app==='windows'&&releases&&!row&&!publicWindows&&!checkingWindows&&!error&&
     <p>Nenhum instalador Windows disponível no momento.</p>}
    {app==='android'&&releases&&!row&&!error&&<p>O aplicativo Android está em homologação. Compartilhe o endereço abaixo com seus entregadores.</p>}
    {app==='android'&&<div className="release-detail">
     <p><a href={COURIER_APP_URL} target="_blank" rel="noopener noreferrer">Abrir Pitacco Entregador</a></p>
     <button type="button" className="secondary" onClick={()=>void share()}>{shared?'Link copiado':'Compartilhar acesso'}</button>
     <p>{COURIER_APP_URL}</p>
    </div>}
   </section>;
  })}
 </div>;
}
