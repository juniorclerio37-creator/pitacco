import React,{useEffect,useState} from 'react';
import {downloadRelease,releaseDate,discoverPublicWindowsInstaller,downloadPublicWindowsInstaller} from './appReleases.mjs';
import './windows-printing.css';

const labels={connected:'Pitacco Windows conectado e autenticado',
 offline:'Aplicativo Windows não conectado neste momento',
 not_detected:'Nenhuma conexão do Pitacco Windows detectada'};
const freshness=time=>time?new Date(time).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'Não disponível';

export function WindowsConnectionStatus({client,storeId,compact=false,onNavigate}){
 const [status,setStatus]=useState(null),[fault,setFault]=useState(''),[revision,refresh]=useState(0);
 const [release,setRelease]=useState(null),[checking,setChecking]=useState(true);
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState('');
 const [publicWindows,setPublicWindows]=useState(null);

 useEffect(()=>{
  let live=true;
  client.from('pitacco_app_releases')
   .select('id,app,version,filename,notes,published_at,sha256')
   .eq('app','windows').eq('channel','stable').eq('state','published')
   .order('published_at',{ascending:false}).limit(1)
   .then(({data,error})=>{if(!live)return;if(error)throw error;setRelease(data?.[0]||null)})
   .catch(()=>{if(live)setDownloadError('Não foi possível consultar a versão estável. Abra a central de downloads.')});
  return()=>{live=false};
 },[client]);

 useEffect(()=>{
  let active=true;
  discoverPublicWindowsInstaller().then(data=>{if(active)setPublicWindows(data)})
   .catch(()=>{if(active)setPublicWindows(null)});
  return()=>{active=false};
 },[]);
 useEffect(()=>{
  if(!storeId)return;
  let live=true,running=false;
  setStatus(null);setFault('');setChecking(true);
  async function load(){
   if(running)return;
   running=true;
   try{
    const {data,error}=await client.rpc('pitacco_windows_connection',{p_store:storeId});
    if(error)throw error;
    if(live){setStatus(data);setFault('');}
   }catch(error){if(live)setFault(error.message||'Não foi possível verificar a conexão Windows.')}
   finally{running=false;if(live)setChecking(false)}
  }
  void load();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},25000);
  return()=>{live=false;clearInterval(timer)};
 },[client,storeId,revision]);

 async function getInstaller(){
  if(!release&&!publicWindows){onNavigate?.('Aplicativos e Downloads');return}
  setDownloading(true);setDownloadError('');
  try{if(release)await downloadRelease(client,release);else downloadPublicWindowsInstaller(publicWindows);}
  catch(error){setDownloadError(error.message||'Falha ao obter o instalador.')}
  finally{setDownloading(false)}
 }
 if(compact){
  const state=fault?'error':checking?'checking':status?.status||'checking';
  const title=state==='connected'?'Aplicativo Windows conectado':state==='offline'?'Aplicativo Windows desconectado':state==='not_detected'?'Aplicativo Windows não detectado':state==='error'?'Não foi possível verificar a conexão':'Verificando conexão…';
  return <section className="windows-link-card compact" aria-label="Conexão do aplicativo Windows">
   <div>
    <span className="eyebrow">PITACCO WINDOWS</span>
    <h4 className={'windows-compact-status '+state} aria-live="polite">{title}</h4>
   </div>
   <p>Sincroniza pedidos e permite impressão automática com a impressora configurada.</p>
   {status?.last_seen_at&&<small>Última atividade: {freshness(status.last_seen_at)}</small>}
   {fault&&<p role="alert">{fault}</p>}
   <div className="windows-link-actions">
    <button type="button" onClick={()=>void getInstaller()} disabled={downloading}>
     {downloading?'Preparando download…':release||publicWindows?'Baixar Pitacco Windows':'Ver versões e downloads'}
    </button>
    <button type="button" className="secondary" onClick={()=>refresh(v=>v+1)}>Atualizar conexão</button>
   </div>
   {downloadError&&<p role="alert">{downloadError}</p>}
  </section>;
 }
 return <section className="windows-link-card" aria-label="Conexão do aplicativo Windows">
  <div className="windows-link-head">
   <div>
    <span className="eyebrow">PITACCO WINDOWS</span>
    <h4>Receba pedidos e imprima automaticamente</h4>
   </div>
   <span className={'windows-connection-state '+(status?.status||'checking')}>
    {checking&&!status?'Consultando…':fault?'Não foi possível verificar':labels[status?.status]||'Verificando conexão'}
   </span>
  </div>
  <p>O aplicativo Windows mantém os pedidos sincronizados, permite aceitar pedidos e, com a impressora configurada, envia as comandas automaticamente após o aceite. A confirmação física depende da impressora e do spooler do Windows.</p>
  {status?.status==='connected'&&<p role="status" className="windows-linked">
   Aplicativo autenticado com atividade recente.
   {status.printer_computer_bound
    ?status.bound_computer_connected?' O computador de impressão vinculado também está conectado.':' Existe um computador de impressão vinculado, mas ele não aparece online.'
    :' Vincule o computador em Impressoras no aplicativo Windows para habilitar a impressão automática.'}
  </p>}
  {status?.status==='offline'&&<p role="status">Há registro de conexão ou computador vinculado, mas nenhum aplicativo autenticado respondeu nos últimos 90 segundos. Abra o Pitacco Windows e entre na loja.</p>}
  {status?.status==='not_detected'&&<p role="status">Não há um aplicativo Windows autenticado detectado para esta loja. O navegador não consegue verificar se o aplicativo está instalado e fechado.</p>}
  {fault&&<p role="alert">{fault}</p>}
  {status?.last_seen_at&&<small>Última atividade confirmada: {freshness(status.last_seen_at)}</small>}
  {status?.last_printer_test&&<div className="windows-last-print-check" aria-label="Último teste de impressão Windows">
   <strong>Último teste de impressora (Windows)</strong>
   <p>{status.last_printer_test.outcome==='printed'
    ?'O operador confirmou que o cupom saiu no papel.'
    :status.last_printer_test.outcome==='failed'
    ?'O operador informou que o cupom não saiu no papel.'
    :status.last_printer_test.outcome==='uncertain'
    ?'O operador não conseguiu confirmar a impressão.'
    :'Teste enviado ao spooler; confirmação física ainda pendente.'}</p>
   <small>{status.last_printer_test.printer_name} · {status.last_printer_test.paper_width} mm · {freshness(status.last_printer_test.confirmed_at||status.last_printer_test.submitted_at)}</small>
   <small>Registro informado no aplicativo Windows. Não comprova a impressão automática de novos pedidos.</small>
  </div>}
  <div className="windows-link-actions">
   <button type="button" onClick={()=>void getInstaller()} disabled={downloading}>
    {downloading?'Preparando download…':release||publicWindows?'Baixar Pitacco Windows':'Ver versões e downloads'}
   </button>
   <button type="button" className="secondary" onClick={()=>refresh(v=>v+1)}>Atualizar conexão</button>
   {release&&<small>Versão estável disponível: {release.version} · {releaseDate(release.published_at)}</small>}
   {!release&&publicWindows&&<small>Instalador Windows disponível · {releaseDate(publicWindows.published_at)}</small>}
  </div>
  {downloadError&&<p role="alert">{downloadError}</p>}
  {!release&&!publicWindows&&!downloadError&&<p className="hint">Consulte a área de Aplicativos e Downloads para obter a versão Windows disponível.</p>}
 </section>;
}
