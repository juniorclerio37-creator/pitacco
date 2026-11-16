import React,{useEffect,useState} from 'react';
import IfoodConnections from './IfoodConnections.jsx';

export default function OwnerIfood({client,stores}){
 const [storeId,setStoreId]=useState(''),[enabled,setEnabled]=useState(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  let live=true;
  client.rpc('pitacco_ifood_linking_status').then(({data,error})=>{
   if(live){if(error)setError(error.message);else setEnabled(data===true);}
  }).catch(()=>{if(live)setError('Não foi possível consultar o iFood.');});
  return()=>{live=false;};
 },[client]);
 async function toggle(){
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
  {storeId&&<IfoodConnections key={storeId} client={client} storeId={storeId} canRead test/>}
  <p role="status">{enabled===null?'Consultando situação…':enabled?'Vínculo automático liberado':'Vínculo automático desativado'}</p>
  <button type="button" disabled={busy||enabled===null} onClick={toggle}>
   {enabled?'Pausar integração dos lojistas':'Liberar após homologação'}
  </button>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
