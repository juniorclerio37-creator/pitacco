import React,{useEffect,useRef,useState} from 'react';
const labels={pending:'Solicitação enviada',awaiting:'Aguardando autorização no iFood',active:'Vínculo habilitado',rejected:'Solicitação recusada — contate o suporte'};
export default function IfoodConnections({client,storeId,canRead,test=false}){
 const [rows,setRows]=useState([]),[requests,setRequests]=useState([]),[linking,setLinking]=useState(false),[ready,setReady]=useState(false),[merchant,setMerchant]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),running=useRef(false);
 async function load(){
  const seq=++generation.current;setError('');
  try{
   const [c,l,r]=await Promise.all([client.rpc('pitacco_ifood_connections',{p_store:storeId}),client.rpc('pitacco_ifood_linking_status'),test?Promise.resolve({data:[]}):client.rpc('pitacco_ifood_central_requests',{p_store:storeId})]);
   if(c.error||l.error||r.error)throw c.error||l.error||r.error;
   if(seq===generation.current){setRows(c.data||[]);setLinking(l.data===true);setRequests(r.data||[]);setReady(true)}
  }catch(e){if(seq===generation.current)setError(e.message||'Não foi possível consultar a integração.')}
 }
 useEffect(()=>{setReady(false);setRows([]);setRequests([]);setMerchant('');setNotice('');if(canRead)load();const timer=canRead&&!test?setInterval(()=>{if(!running.current)load()},15000):null;return()=>{generation.current++;if(timer)clearInterval(timer)}},[client,storeId,canRead,test]);
 async function submit(e){
  e.preventDefault();if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('');
  try{
   const r=await client.rpc('pitacco_ifood_central_request',{p_store:storeId,p_merchant:merchant.trim()});
   if(r.error)throw r.error;setMerchant('');setNotice('Solicitação enviada. O Pitacco solicitará a permissão no iFood.');await load();
  }catch(e){setError(e.message||'Não foi possível enviar a solicitação.')}
  finally{running.current=false;setBusy(false)}
 }
 const visible=rows.filter(row=>test?row.test_only:!row.test_only);
 return <section className="panel" aria-label="Integração centralizada com iFood">
  <h3>Integração iFood · {test?'Homologação':'Centralizada'}</h3>
  {!canRead&&<p>Somente o gestor da loja pode consultar e solicitar vínculos.</p>}
  {canRead&&<button type="button" className="secondary" disabled={busy} onClick={load}>Atualizar situação</button>}
  {canRead&&!ready&&!error&&<p role="status">Consultando vínculos…</p>}
  {canRead&&ready&&visible.length===0&&<p>Nenhuma conta iFood vinculada.</p>}
  {canRead&&visible.length>0&&<ul>{visible.map(row=><li key={row.merchant_id}><code>{row.merchant_id}</code> · {row.enabled?'Vínculo habilitado':'Vínculo pausado'}</li>)}</ul>}
  {canRead&&test&&<p>Os vínculos de homologação são configurados separadamente no Portal do Desenvolvedor. As solicitações comerciais não alteram o ambiente de testes.</p>}
  {canRead&&!test&&ready&&linking&&<form onSubmit={submit}>
   <label>Identificador da loja no iFood (Merchant ID)<input required maxLength={36} pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}" value={merchant} onChange={e=>setMerchant(e.target.value)}/></label>
   <p>Informe o ID do seu estabelecimento. O Pitacco solicitará a permissão; depois você deverá aprová-la no Portal do Parceiro iFood.</p>
   <button disabled={busy}>{busy?'Enviando…':'Solicitar integração'}</button>
  </form>}
  {canRead&&!test&&ready&&!linking&&<p>Novas solicitações estão temporariamente pausadas.</p>}
  {canRead&&!test&&requests.length>0&&<><h4>Minhas solicitações</h4><ul>{requests.map(r=><li key={r.id}><code>{r.merchant_id}</code> · {labels[r.state]||r.state}{r.state==='awaiting'&&<> · <a href="https://portal.ifood.com.br/" target="_blank" rel="noopener noreferrer">Autorizar no Portal do Parceiro</a></>}</li>)}</ul></>}
  {!test&&<p>Após autorizar no iFood, o Pitacco verifica a permissão automaticamente. Esta página se atualiza a cada 15 segundos.</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
