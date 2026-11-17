import React,{useEffect,useState} from 'react';
import DeliveryDialog,{deliveryLabel} from './DeliveryDialog.jsx';
export default function LogisticsHub({client,store,view,onRefresh}){
 const [rows,setRows]=useState([]),[couriers,setCouriers]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{const [d,c]=await Promise.all([client.from('deliveries').select('*').eq('store_id',store.id).order('created_at',{ascending:false}).limit(200),client.from('couriers').select('*').eq('store_id',store.id).order('name')]);if(d.error||c.error)throw d.error||c.error;setRows(d.data);setCouriers(c.data)};
 useEffect(()=>{let live=true;const refresh=()=>load().catch(e=>live&&setError(e.message));refresh();const t=setInterval(refresh,5000);return()=>{live=false;clearInterval(t)}},[store.id]);
 async function rpc(name,args){setBusy(true);setError('');setNotice('');try{const r=await client.rpc(name,args);if(r.error)throw r.error;await load();await onRefresh?.();setNotice('Alteração salva.')}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <>{error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {view==='Entregadores'&&<><div className="panel"><h3>Equipe de entregadores</h3>{couriers.map(c=><div className="line" key={c.id}><b>{c.name}</b><span>{c.phone||'Telefone não informado'}</span><span className="badge neutral">{c.available?'Disponibilidade ativada':'Offline'}</span><span>{rows.filter(d=>d.courier_id===c.id&&!['entregue','cancelada'].includes(d.status)).length} pedidos ativos</span></div>)}{!couriers.length&&<p>Cadastre sua equipe para atribuir as entregas.</p>}</div></>}
 {view==='Entregas'&&<>
 {view==='Entregas'&&<section className="panel" aria-label="Configuração de alocação automática">
  <span className="eyebrow">ENTREGAS · DISTRIBUIÇÃO</span>
  <h3>Alocação automática</h3>
  <p>Configure o modo de atribuição e o limite de pedidos por rota. O sistema considera disponibilidade do entregador, GPS recente e compatibilidade do trajeto quando houver roteirização validada. Sem validação, os pedidos permanecem aguardando entregador.</p>
  <form key={store.id+':'+store.dispatch_mode+':'+store.max_orders_per_trip}
    onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);
      void rpc('set_dispatch_policy',{s:store.id,dispatch:String(data.get('mode')),max_orders:Number(data.get('max'))});
    }}>
    <label className="field">Modo de alocação
      <select name="mode" defaultValue={store.dispatch_mode||'manual'} disabled={busy}>
        <option value="manual">Manual</option>
        <option value="automatico">Automática</option>
        <option value="misto">Mista</option>
      </select>
    </label>
    <label className="field">Máximo de pedidos por rota
      <input name="max" type="number" min="1" max="15" required disabled={busy}
       defaultValue={store.max_orders_per_trip||1}/>
    </label>
    <button type="submit" disabled={busy}>Salvar alocação</button>
  </form>
  <p className="hint">O endereço de saída é o endereço cadastrado da loja. Sua localização é validada pela Área de Entrega, sem digitar latitude ou longitude. A alocação automática não contrata entregas de terceiros.</p>
 </section>}
<div className="metrics"><article><span>Aguardando</span><strong>{rows.filter(d=>d.status==='pendente'&&d.logistics_provider==='loja').length}</strong></article><article><span>Em coleta</span><strong>{rows.filter(d=>['atribuida','aceita'].includes(d.status)).length}</strong></article><article><span>Em entrega</span><strong>{rows.filter(d=>d.status==='retirada').length}</strong></article></div><div className="panel"><h3>Entregas e rotas</h3><p>Selecione um pedido para consultar a logística e atribuir seu entregador.</p>{rows.map(d=><div className="delivery-row" key={d.id}><div><b>{d.customer_name}</b><p>{d.address}</p><small>{deliveryLabel(d)}{d.batch_id?' · Rota '+d.batch_id.slice(0,8):''}</small></div><div><span>{couriers.find(c=>c.id===d.courier_id)?.name}</span><button className="secondary" onClick={()=>setSelected(d)}>Entrega e entregador</button></div></div>)}{!rows.length&&<p>Nenhuma entrega recebida.</p>}</div><details className="panel"><summary>Registrar entrega avulsa</summary><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);rpc('create_delivery',{s:store.id,customer:f.get('customer'),destination:f.get('address'),details:f.get('notes'),fee:Number(f.get('fee')),payment:Number(f.get('payment'))})}}><label className="field">Cliente<input name="customer" required/></label><label className="field">Endereço<input name="address" required/></label><label className="field">Observações<input name="notes"/></label><label className="field">Taxa do cliente<input name="fee" type="number" min="0" step="0.01" required/></label><label className="field">Repasse<input name="payment" type="number" min="0" step="0.01" required/></label><button disabled={busy}>Criar entrega</button></form></details></>}
 {selected&&<DeliveryDialog key={selected.id} client={client} storeId={store.id} deliveryId={selected.id} order={{id:selected.order_id||selected.id,source:selected.source,receipt:{customer:selected.customer_name,address:selected.address}}} onClose={()=>setSelected(null)} onUpdate={load}/>}
 </>
}
