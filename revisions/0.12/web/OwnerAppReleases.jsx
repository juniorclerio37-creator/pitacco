import React,{useEffect,useState} from 'react';
import {downloadRelease,fileSha256,RELEASE_BUCKET,RELEASE_LIMIT,releaseDate,releasePath} from './appReleases.mjs';
import './app-releases.css';

const states={draft:'Rascunho',published:'Publicado',withdrawn:'Retirado'};
const events={draft:'Rascunho criado',verified:'Integridade verificada',published:'Publicado',withdrawn:'Retirado',replaced:'Substituído'};

export default function OwnerAppReleases({client}){
 const [rows,setRows]=useState([]),[history,setHistory]=useState([]),[selected,setSelected]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [app,setApp]=useState('windows'),[reviewed,setReviewed]=useState(false);
 const release=rows.find(row=>row.id===selected);

 async function load(){
  setLoading(true);
  try{
   const {data,error}=await client.from('pitacco_app_releases').select('*').order('created_at',{ascending:false}).limit(100);
   if(error)throw error;
   setRows(data);
  }finally{setLoading(false)}
 }
 useEffect(()=>{load().catch(()=>setError('Não foi possível carregar as versões.'));},[client]);
 useEffect(()=>{
  let live=true;
  setReviewed(false);setHistory([]);
  if(selected)client.from('pitacco_app_release_audit').select('action,actor,created_at').eq('release_id',selected)
   .order('id',{ascending:false}).limit(40).then(({data,error})=>{
    if(live){if(error)setError('Não foi possível consultar a auditoria.');else setHistory(data)}
   });
  return()=>{live=false;};
 },[client,selected,rows]);

 async function run(action,success){
  setBusy(true);setError('');setNotice('');
  try{await action();setNotice(success);}
  catch(failure){setError(failure.message||'Não foi possível concluir a operação.');}
  finally{setBusy(false);}
 }
 async function verify(id){
  const {data,error}=await client.functions.invoke('app-release-integrity',{body:{id}});
  if(error||data?.verified!==true){
   const detail=await error?.context?.json?.().catch(()=>null);
   throw Error(detail?.error||'Não foi possível validar o arquivo no servidor.');
  }
 }
 async function upload(row,file){
  if(!file?.size||file.size!==row.size_bytes||await fileSha256(file)!==row.sha256){
   throw Error('Selecione o instalador original com o tamanho e SHA-256 deste rascunho.');
  }
  const {error}=await client.storage.from(RELEASE_BUCKET).upload(releasePath(row),file,{
   upsert:false,contentType:'application/octet-stream'
  });
  if(error)throw Error('Falha no envio. Se o arquivo já existe, use Validar envio.');
  await verify(row.id);
 }
 function create(event){
  event.preventDefault();
  const form=event.currentTarget, data=new FormData(form), file=data.get('file');
  void run(async()=>{
   const filename=file.name.replace(/\.[^.]+$/,suffix=>suffix.toLowerCase());
   const sha256=String(data.get('sha256')).trim().toLowerCase();
   const extension=app==='windows'?/\.(exe|msi)$/:/\.apk$/;
   if(!file.size||file.size>RELEASE_LIMIT||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,118}\.(exe|msi|apk)$/.test(filename)||!extension.test(filename)){
    throw Error('Escolha um instalador compatível, com nome simples e tamanho de até 50 MB.');
   }
   if(await fileSha256(file)!==sha256)throw Error('O SHA-256 informado difere do instalador selecionado.');
   const {data:id,error}=await client.rpc('pitacco_create_release',{
    p_app:app,p_channel:data.get('channel'),p_version:String(data.get('version')).trim(),p_filename:filename,
    p_notes:data.get('notes'),p_requirements:data.get('requirements'),p_recommended:data.has('recommended'),
    p_sha256:sha256,p_size:file.size,
   });
   if(error)throw Error(error.code==='23505'?'Esta versão já existe neste canal. Abra o rascunho no histórico.':error.message);
   setSelected(id);form.reset();setApp('windows');
   try{await upload({id,filename,sha256,size_bytes:file.size},file);}
   finally{await load();}
  },'Arquivo verificado e salvo como rascunho.');
 }
 function transition(action){
  void run(async()=>{
   const {error}=await client.rpc('pitacco_release_transition',{p_id:release.id,p_action:action,p_reviewed:reviewed});
   if(error)throw error;
   await load();
  },action==='publish'?'Versão publicada no canal selecionado.':'Versão retirada do canal.');
 }
 function retryUpload(event){
  event.preventDefault();
  const file=new FormData(event.currentTarget).get('retry-file');
  void run(async()=>{await upload(release,file);await load();},'Arquivo verificado.');
 }

 return <div className="app-releases">
  <section className="panel"><h3>Nova versão</h3>
   <form onSubmit={create} className="release-form">
    <label>Aplicativo<select name="app" aria-label="Aplicativo" value={app} onChange={event=>setApp(event.target.value)}><option value="windows">Pitacco Windows</option><option value="android">Pitacco Entregador Android</option></select></label>
    <label>Canal<select name="channel" aria-label="Canal"><option value="stable">Estável</option><option value="test">Testes</option></select></label>
    <label>Versão<input name="version" required maxLength={64} placeholder="1.2.3"/></label>
    <label>Instalador<input name="file" type="file" required accept={app==='windows'?'.exe,.msi':'.apk'}/></label>
    <label className="release-wide">SHA-256 da compilação<input name="sha256" required pattern="[0-9a-fA-F]{64}" maxLength={64} spellCheck="false"/></label>
    <label className="release-wide">Novidades e correções<textarea name="notes" rows={3} maxLength={3000}/></label>
    <label className="release-wide">Requisitos<textarea name="requirements" rows={2} maxLength={1000}/></label>
    <label className="release-check release-wide"><input type="checkbox" name="recommended"/> Recomendar atualização</label>
    <button disabled={busy||loading}>Enviar e salvar rascunho</button>
   </form>
  </section>
  {busy&&<p role="status">Processando versão…</p>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <section className="panel"><h3>Versões</h3>
   {loading?<p role="status">Carregando versões…</p>:rows.length===0?<p>Nenhuma versão cadastrada.</p>:
    <label>Selecione no histórico<select aria-label="Selecione no histórico" value={selected} onChange={event=>setSelected(event.target.value)}>
     <option value="">Selecione uma versão</option>
     {rows.map(row=><option key={row.id} value={row.id}>{row.app==='windows'?'Windows':'Android'} · {row.version} · {row.channel==='stable'?'Estável':'Testes'} · {states[row.state]}</option>)}
    </select></label>}
   <button type="button" className="secondary" disabled={busy||loading} onClick={()=>void run(load,'Lista atualizada.')}>Atualizar lista</button>
   {release&&<div className="release-detail">
    <h4>{release.filename}</h4>
    <p>{states[release.state]} · {release.verified_at?'Integridade verificada':'Aguardando verificação'} · {releaseDate(release.created_at)}</p>
    <details><summary>Metadados e auditoria</summary>
     <p>SHA-256 <code>{release.sha256}</code></p><p>{release.notes}</p><p>{release.requirements}</p>
     <ul>{history.map((entry,index)=><li key={index}>{events[entry.action]} · {new Date(entry.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {entry.actor}</li>)}</ul>
    </details>
    {!release.verified_at&&<><form onSubmit={retryUpload}>
     <label>Reenviar instalador original<input name="retry-file" type="file" required accept={release.app==='windows'?'.exe,.msi':'.apk'}/></label>
     <button disabled={busy}>Reenviar</button></form>
     <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{await verify(release.id);await load();},'Arquivo verificado.')}>Validar envio</button></>}
    {release.verified_at&&<button type="button" className="secondary" disabled={busy} onClick={()=>void run(()=>downloadRelease(client,release),'Download iniciado.')}>Baixar para conferir</button>}
    {release.verified_at&&release.state!=='published'&&<>
     <label className="release-check"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/> Conferi a origem, a assinatura e o resultado da análise de segurança do instalador.</label>
     <p>A publicação substitui a versão atual deste aplicativo no mesmo canal.</p>
     <button type="button" disabled={busy||!reviewed} onClick={()=>transition('publish')}>Publicar versão</button></>}
    {release.state==='published'&&<button type="button" disabled={busy} onClick={()=>transition('withdraw')}>Retirar publicação</button>}
   </div>}
  </section>
 </div>;
}
