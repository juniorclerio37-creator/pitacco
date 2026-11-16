import React,{useEffect,useState} from 'react';

export default function OwnerStoreIfood({client,storeId}){
 const [status,setStatus]=useState(null),[busy,setBusy]=useState(true);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [revision,setRevision]=useState(0),[pending,setPending]=useState(false);

 useEffect(()=>{
  let active=true;
  const controller=new AbortController();
  async function load(){
   setBusy(true);setError('');
   try{
    const {data,error}=await client.rpc('pitacco_owner_ifood_store_status',{p_store:storeId}).abortSignal(controller.signal);
    if(error||typeof data?.paused!=='boolean')throw error||Error('Situação indisponível.');
    if(active)setStatus(data);
   }catch{
    if(active)setError('Não foi possível consultar o recebimento do iFood.');
   }finally{if(active)setBusy(false);}
  }
  void load();
  return()=>{active=false;controller.abort();};
 },[client,storeId,revision]);

 async function save(){
  setBusy(true);setPending(false);setError('');setMessage('');
  try{
   const {data,error}=await client.rpc('pitacco_owner_set_ifood_store_pause',{p_store:storeId,p_paused:!status.paused});
   if(error||typeof data?.paused!=='boolean')throw error||Error('Situação indisponível.');
   setStatus(data);
   setMessage(data.paused?'Recebimento do iFood pausado para esta loja.':'Pausa removida para esta loja.');
  }catch{setError('Não foi possível salvar a alteração do recebimento.');}
  finally{setBusy(false);}
 }

 return <section className="panel" aria-label="Controle do iFood da loja" aria-busy={busy}>
  <h3>Recebimento de pedidos do iFood</h3>
  {busy&&!status&&<p role="status">Consultando situação…</p>}
  {status&&<>
   <p><strong>{status.paused?'Recebimento pausado nesta loja':'Recebimento permitido nesta loja'}</strong></p>
   {!status.linking_released&&<p>A integração geral aguarda liberação na aba Homologação.</p>}
   {status.connections===0?<p>Nenhuma conta de produção vinculada. O lojista autoriza a própria conta no Portal do Parceiro.</p>
    :<p>Contas de produção vinculadas: {status.connections}. Contas autorizadas: {status.enabled_connections}.</p>}
   <p>O controle vale para todas as contas de produção desta loja. Os vínculos e o histórico de pedidos ficam disponíveis.</p>
   {pending?<div className="quick-actions">
    <button type="button" onClick={save} disabled={busy}>Confirmar pausa</button>
    <button type="button" className="secondary" onClick={()=>setPending(false)} disabled={busy}>Voltar</button>
   </div>:<button type="button" disabled={busy} onClick={status.paused?save:()=>setPending(true)}>
    {busy?'Salvando…':status.paused?'Remover pausa do iFood':'Pausar iFood nesta loja'}
   </button>}
  </>}
  {error&&<p role="alert">{error}</p>}
  {error&&!status&&<button type="button" className="secondary" onClick={()=>setRevision(value=>value+1)}>Tentar novamente</button>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
