import React,{useEffect,useRef,useState} from 'react';
import IfoodConnections from './IfoodConnections.jsx';
import IfoodShippingTest from './IfoodShippingTest.jsx';
import OwnerIfoodCentralRequests from './OwnerIfoodCentralRequests.jsx';

export default function OwnerIfood({client,stores,initialStore=''}){
 const [storeId,setStoreId]=useState(initialStore),[enabled,setEnabled]=useState(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let live=true;
  client.rpc('pitacco_ifood_linking_status').then(({data,error})=>{
   if(live){if(error)setError(error.message);else setEnabled(data===true);}
  }).catch(()=>{if(live)setError('Não foi possível consultar o iFood.');});
  return()=>{live=false;};
 },[client]);
 async function toggle(){
  if(!enabled&&!window.confirm('A aprovação oficial do iFood já foi recebida? Esta ação libera o vínculo para os lojistas.'))return;
  setBusy(true);setError('');
  try{
   const {error}=await client.rpc('pitacco_owner_enable_ifood_linking',{p_enabled:!enabled});
   if(error)throw error;
   setEnabled(!enabled);
  }catch(error){setError(error.message);}
  finally{setBusy(false);}
 }
 return <section className="panel" aria-label="Homologação geral do iFood">
  <h3>Homologação geral do iFood</h3>
  <p>Vincule uma loja de testes e valide a chegada do pedido e os avisos no painel e no Windows. Libere o vínculo dos lojistas após a aprovação oficial no Portal do Desenvolvedor.</p>
  <label>Loja Pitacco usada na homologação
   <select value={storeId} onChange={e=>setStoreId(e.target.value)}>
    <option value="">Selecione a loja de teste</option>
    {stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}
   </select>
  </label>
  {storeId&&<React.Fragment key={storeId}><IfoodConnections client={client} storeId={storeId} canRead test/><IfoodTests client={client} store={storeId}/><IfoodShippingTest client={client} store={storeId}/></React.Fragment>}
  {!storeId&&<p>Selecione a loja de testes para abrir o vínculo e as cinco etapas. Não é necessário liberar os lojistas para testar.</p>}
  <h4>Liberação comercial</h4>
  <p>Use apenas após aprovação oficial do iFood. Os registros abaixo não substituem a homologação no portal.</p>
  <p role="status">{enabled===null?'Consultando situação…':enabled?'Solicitações centralizadas liberado':'Solicitações centralizadas desativado'}</p>
  <button type="button" disabled={busy||enabled===null} onClick={toggle}>
   {enabled?'Pausar integração dos lojistas':'Liberar após homologação'}
  </button>
  {error&&<p role="alert">{error}</p>}
  <OwnerIfoodCentralRequests client={client}/>
 </section>;
}

const stages=[
 ['connectivity','Testar conectividade','Vincule o Merchant ID de teste, confira a situação da loja e clique em Testar conexão no portal iFood. Anexe as capturas reais no portal.'],
 ['receive','Receber e confirmar pedidos','Gere o pedido de teste pelo portal iFood. Confira os dados, os alertas do painel e Windows e a confirmação oficial do aceite.'],
 ['cancel','Cancelar pedidos','Execute o cenário de cancelamento solicitado pelo portal e confira o motivo e a atualização do estado nas duas plataformas.'],
 ['dispatch','Despachar pedidos','Execute o preparo e despacho no fluxo indicado pelo iFood. Confira a confirmação externa; não conclua automaticamente.'],
 ['validate','Validar pedidos','Execute os cenários restantes e a validação solicitada pelo portal. Confira os estados finais e registre a aprovação oficial quando recebida.']
];
const results={pending:'Pendente',failed:'Com falha',approved:'Aprovado em teste'};
const prefix=key=>'[iFood homologação:'+key+'] ';
function IfoodTests({client,store}){
 const [stage,setStage]=useState(stages[0][0]),[history,setHistory]=useState(null),[connections,setConnections]=useState(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useRef(null),saving=useRef(false),generation=useRef(0);
 async function refresh(){
  const current=++generation.current;
  setLoading(true);setError('');
  try{
   const [h,c]=await Promise.all([client.rpc('pitacco_admin_homologation_results'),client.rpc('pitacco_ifood_connections',{p_store:store})]);
   if(h.error||c.error)throw h.error||c.error;
   if(current!==generation.current)return;
   setHistory((h.data||[]).filter(row=>row.store_id===store&&row.scope==='marketplaces'&&stages.some(([key])=>row.notes.startsWith(prefix(key)))));
   setConnections((c.data||[]).filter(row=>row.test_only));
  }catch(e){if(current===generation.current)setError(e.message||'Não foi possível consultar os testes.');}
  finally{if(current===generation.current)setLoading(false);}
 }
 useEffect(()=>{refresh();return()=>{generation.current++;};},[client,store]);
 async function save(event){
  event.preventDefault();
  if(saving.current)return;
  const form=event.currentTarget,fields=new FormData(form),notes=String(fields.get('notes')||'').trim();
  if(notes.length<3){setError('Informe a evidência real do teste.');return;}
  saving.current=true;setBusy(true);setError('');setNotice('');
  try{
   const params={p_store:store,p_scope:'marketplaces',p_outcome:fields.get('outcome'),p_notes:prefix(stage)+notes};
   const signature=JSON.stringify(params);
   if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
   const {error}=await client.rpc('pitacco_admin_record_homologation',{...params,p_request:request.current.id});
   if(error)throw error;
   request.current=null;form.reset();setNotice('Resultado registrado no histórico.');await refresh();
  }catch(e){setError(e.message||'Não foi possível salvar o resultado.');}
  finally{saving.current=false;setBusy(false);}
 }
 const latest=key=>history?.find(row=>row.notes.startsWith(prefix(key)));
 return <section aria-label="Cinco etapas de homologação iFood">
  <h4>Roteiro oficial de homologação — Order e Events</h4>
  <p><a href="https://developer.ifood.com.br/pt-BR/" target="_blank" rel="noopener noreferrer">Abrir Portal do Desenvolvedor iFood</a> · Método: Polling</p>
  <button type="button" className="secondary" disabled={busy||loading} onClick={refresh}>{loading?'Consultando…':'Atualizar vínculo e resultados'}</button>
  {connections&&<p role="status">{connections.some(row=>row.enabled)?'Vínculo de teste habilitado no Pitacco. Confirme a conectividade no portal iFood.':'Nenhum vínculo de teste habilitado. Faça a autorização acima.'}</p>}
  <p>Resultados internos registrados nas últimas 50 ocorrências gerais. Somente o portal iFood confirma a aprovação oficial.</p>
  <div className="owner-dashboard-table" tabIndex={0}><table aria-label="Etapas oficiais iFood"><thead><tr><th>Etapa</th><th>Último registro</th></tr></thead>
   <tbody>{stages.map(([key,label],i)=><tr key={key}><th scope="row">{i+1}. {label}</th><td>{results[latest(key)?.outcome]||'Sem registro'}</td></tr>)}</tbody>
  </table></div>
  <form onSubmit={save}>
   <label>Etapa <select value={stage} disabled={busy} onChange={event=>setStage(event.target.value)}>{stages.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <p>{stages.find(([key])=>key===stage)[2]}</p>
   <label>Resultado <select name="outcome" disabled={busy}>{Object.entries(results).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>Evidência / referência do pedido ou teste <textarea name="notes" required minLength={3} maxLength={1100} rows={3} disabled={busy}/></label>
   <p>Não informe credenciais ou tokens. Envie as capturas exigidas diretamente ao portal iFood.</p>
   <button disabled={busy||loading}>{busy?'Salvando…':'Registrar resultado da etapa'}</button>
  </form>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <h4>Histórico de testes iFood</h4>
  {history&&(!history.length?<p>Nenhum registro recente.</p>:<ul>{history.map(row=><li key={row.id}><strong>{results[row.outcome]}</strong> · {new Date(row.recorded_at).toLocaleString('pt-BR')}<p>{row.notes}</p></li>)}</ul>)}
 </section>;
}
