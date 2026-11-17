import React,{useEffect,useState} from 'react';
const labels={
 acceptance_late:'Pedido aguardando aceite',
 preparation_late:'Preparo acima do prazo',
 delivery_late:'Entrega atrasada',
 print_error:'Falha de impressão',
 marketplace_acceptance_failed:'Aceite recusado pelo marketplace',
 delivery_partner_failed:'Falha na solicitação de entrega parceira',
 payment_failed:'Falha de pagamento registrada'
};
const when=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});

export default function IncidentCenter({client,storeId=null,stores=[],owner=false}){
 const [store,setStore]=useState(storeId||''),[status,setStatus]=useState('open'),[page,setPage]=useState(0);
 const [revision,refresh]=useState(0),[data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[ack,setAck]=useState(null),[reason,setReason]=useState('');

 useEffect(()=>{
  let live=true;let running=false;
  async function load(){
   if(running)return;running=true;
   try{
    const {data,error}=await client.rpc('pitacco_incidents',{p_store:storeId||store||null,p_status:status,p_page:page});
    if(error)throw error;
    if(live){setData(data);setError('');}
   }catch(failure){if(live)setError(failure.message||'Não foi possível consultar os incidentes.');}
   finally{running=false}
  }
  void load();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);
  return()=>{live=false;clearInterval(timer)};
 },[client,storeId,store,status,page,revision]);

 async function acknowledge(event){
  event.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const {error}=await client.rpc('pitacco_owner_acknowledge_incident',{p_incident:ack,p_reason:reason.trim()});
   if(error)throw error;
   setAck(null);setReason('');setNotice('Incidente reconhecido. Ele continuará aberto enquanto a falha persistir.');
   refresh(i=>i+1);
  }catch(failure){setError(failure.message||'Não foi possível registrar o reconhecimento.');}
  finally{setBusy(false)}
 }

 return <section className="panel" aria-label={owner?'Monitoramento global de incidentes':'Diagnóstico automático da loja'}>
  <h3>{owner?'Monitoramento automático · Todas as lojas':'Diagnóstico automático da loja'}</h3>
  <p>O Pitacco registra problemas detectáveis no servidor e indica quando deixam de ocorrer. O monitoramento não reenvia pedidos, não cobra novamente e não declara uma impressão concluída sem confirmação.</p>
  <div className="dispatch-actions">
   {owner&&<label>Loja<select aria-label="Filtrar incidentes por loja" value={store} onChange={e=>{setStore(e.target.value);setPage(0)}}>
    <option value="">Todas as lojas</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
   </select></label>}
   <label>Situação<select aria-label="Filtrar situação dos incidentes" value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}>
    <option value="open">Em aberto</option><option value="resolved">Resolvidos</option><option value="all">Todos</option>
   </select></label>
   <button type="button" className="secondary" onClick={()=>refresh(i=>i+1)}>Atualizar diagnóstico</button>
  </div>
  {error&&<p role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!data&&!error&&<p role="status">Consultando ocorrências…</p>}
  {data?.rows?.length===0&&<p>Nenhum incidente registrado para este filtro.</p>}
  <ul>{data?.rows?.map(row=><li key={row.id} style={{margin:'12px 0'}}>
    <strong>{labels[row.code]||row.code}</strong> · {row.status==='open'?'Em aberto':'Resolvido'}
    {owner&&<span> · {row.store_name}</span>}
    <div><small>Detectado: {when.format(new Date(row.first_seen_at))} · Última verificação: {when.format(new Date(row.last_seen_at))}</small></div>
    <div><small>Identificador técnico: {row.entity_id.slice(0,8)} · {row.detections} verificação(ões)</small></div>
    {row.acknowledged_at&&<div><small>Reconhecido pelo suporte em {when.format(new Date(row.acknowledged_at))}</small></div>}
    {owner&&row.status==='open'&&!row.acknowledged_at&&<button type="button" className="secondary" onClick={()=>{setAck(row.id);setReason('')}}>Reconhecer ocorrência</button>}
  </li>)}</ul>
  {owner&&ack&&<form aria-label="Reconhecer incidente" onSubmit={acknowledge}>
   <label>Motivo do reconhecimento<textarea value={reason} onChange={e=>setReason(e.target.value)} required minLength={5} maxLength={500}/></label>
   <button disabled={busy}>Confirmar reconhecimento</button>
   <button type="button" className="secondary" onClick={()=>setAck(null)}>Cancelar</button>
  </form>}
  {(page>0||data?.has_more)&&<div className="dispatch-actions">
   <button type="button" className="secondary" disabled={page===0} onClick={()=>setPage(x=>x-1)}>Anterior</button>
   <span>Página {page+1}</span>
   <button type="button" className="secondary" disabled={!data?.has_more} onClick={()=>setPage(x=>x+1)}>Próxima</button>
  </div>}
 </section>;
}
