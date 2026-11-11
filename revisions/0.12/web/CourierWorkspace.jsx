import React,{useEffect,useMemo,useState} from 'react';
import LogisticsHub from './LogisticsHub.jsx';
import CourierFinance from './CourierFinance.jsx';
import CourierRates from './CourierRates.jsx';
const cash=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const tabs=['Entregadores','Entregas','Pagamentos','Regras de Cobrança','Acerto Rápido','Relatórios','Histórico','Desempenho'];
export default function CourierWorkspace({client,store,onRefresh,onNavigate}){
 const [tab,setTab]=useState('Entregadores'),[couriers,setCouriers]=useState([]),[deliveries,setDeliveries]=useState([]),[payments,setPayments]=useState([]),[query,setQuery]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let alive=true;async function refresh(){try{const [a,b,c]=await Promise.all([client.from('couriers').select('*').eq('store_id',store.id),client.from('deliveries').select('*').eq('store_id',store.id).order('created_at',{ascending:false}).limit(500),client.from('pitacco_courier_payouts').select('*').eq('store_id',store.id)]);for(const r of [a,b,c])if(r.error)throw r.error;if(alive){setCouriers(a.data||[]);setDeliveries(b.data||[]);setPayments(c.data||[]);setError('')}}catch(e){if(alive)setError(e.message)}}refresh();const timer=setInterval(refresh,15000);return()=>{alive=false;clearInterval(timer)}},[client,store.id]);
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 const completed=deliveries.filter(d=>d.status==='entregue'),todayDone=completed.filter(d=>d.updated_at&&new Date(d.updated_at).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})===today);
 const todayPayout=todayDone.reduce((s,d)=>s+Number(d.courier_payment||0),0);
 const active=deliveries.filter(d=>!['entregue','cancelada'].includes(d.status));
 const byCourier=id=>todayDone.filter(d=>d.courier_id===id);
 const shown=couriers.filter(c=>c.name?.toLowerCase().includes(query.toLowerCase()));
 const metrics=[['Entregas hoje',todayDone.length],['Valor das entregas',cash(todayDone.reduce((s,d)=>s+Number(d.fee||0),0))],['Repasses aos motoboys',cash(todayPayout)],['Custo médio/entrega',cash(todayDone.length?todayPayout/todayDone.length:0)],['Entregas em andamento',active.length],['Taxa de conclusão',deliveries.length?((completed.length/deliveries.length)*100).toFixed(1)+'%':'—']];
 return <section className="courier-workspace">
 <header><h2>Motoboys e Entregas</h2><p>Gestão da equipe, pagamentos e desempenho da loja.</p></header>
 {error&&<p role="alert" className="notice error">{error}</p>}
 <div className="courier-kpis">{metrics.map(([name,value])=><article key={name}><small>{name}</small><strong>{value}</strong></article>)}</div>
 <nav className="courier-nav" aria-label="Seções de motoboys">{tabs.map(t=><button key={t} className={tab===t?'active':''} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
 {tab==='Entregadores'&&<><div className="panel"><div className="courier-heading"><h3>Entregadores ({couriers.length})</h3><input aria-label="Buscar entregador" placeholder="Buscar entregador..." value={query} onChange={e=>setQuery(e.target.value)}/><button onClick={()=>document.getElementById('courier-register')?.scrollIntoView({behavior:'smooth'})}>Cadastrar entregador</button></div><div style={{overflowX:'auto'}}><table><thead><tr><th>Entregador</th><th>Status</th><th>Entregas hoje</th><th>Valor a receber</th><th>Pedidos ativos</th></tr></thead><tbody>{shown.map(c=><tr key={c.id}><td>{c.name}<small style={{display:'block'}}>{c.phone||'Sem telefone'}</small></td><td>{c.available?'Disponível':'Indisponível'}</td><td>{byCourier(c.id).length}</td><td>{cash(byCourier(c.id).reduce((s,d)=>s+Number(d.courier_payment||0),0))}</td><td>{active.filter(d=>d.courier_id===c.id).length}</td></tr>)}</tbody></table></div></div><div id="courier-register"><LogisticsHub client={client} store={store} view="Entregadores" onRefresh={onRefresh}/></div></>}
 {tab==='Entregas'&&<LogisticsHub client={client} store={store} view="Entregas" onRefresh={onRefresh}/>}
 {tab==='Pagamentos'&&<CourierFinance client={client} storeId={store.id} view="Pagamento de motoboys"/>}
 {tab==='Regras de Cobrança'&&<CourierRates client={client} storeId={store.id}/>}
 {tab==='Acerto Rápido'&&<CourierFinance client={client} storeId={store.id} view="Pagamento de motoboys"/>}
 {tab==='Relatórios'&&<CourierFinance client={client} storeId={store.id} view="Relatório de motoboys"/>}
 {tab==='Histórico'&&<div className="panel"><h3>Histórico de entregas</h3><div style={{overflowX:'auto'}}><table><thead><tr><th>Cliente</th><th>Entregador</th><th>Status</th><th>Data</th></tr></thead><tbody>{deliveries.map(d=><tr key={d.id}><td>{d.customer_name||'—'}</td><td>{couriers.find(c=>c.id===d.courier_id)?.name||'Não atribuído'}</td><td>{d.status}</td><td>{d.updated_at?new Date(d.updated_at).toLocaleString('pt-BR'):'—'}</td></tr>)}</tbody></table></div></div>}
 {tab==='Desempenho'&&<div className="panel"><h3>Desempenho por entregador</h3><table><thead><tr><th>Entregador</th><th>Entregas concluídas</th><th>Repasses registrados</th></tr></thead><tbody>{couriers.map(c=><tr key={c.id}><td>{c.name}</td><td>{completed.filter(d=>d.courier_id===c.id).length}</td><td>{cash(completed.filter(d=>d.courier_id===c.id).reduce((s,d)=>s+Number(d.courier_payment||0),0))}</td></tr>)}</tbody></table><p>Indicadores de prazo, avaliação e gráficos serão exibidos quando houver dados verificados para essas métricas.</p></div>}
 </section>
}
