import React,{useEffect,useState} from 'react';
import {Bike, ClipboardList, Clock3, RefreshCw, Store, Truck} from 'lucide-react';
import './owner-dashboard.css';

const number=new Intl.NumberFormat('pt-BR');
const currency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const time=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
const channels={proprio:'Cardápio próprio e balcão',ifood:'iFood','99food':'99Food',keeta:'Keeta'};
const subscriptions={active:'Ativa',trial:'Em teste',overdue:'Vencida',legacy:'Cadastro anterior à cobrança'};

export default function OwnerDashboard({client,onStore}){
 const [draft,setDraft]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [revision,refresh]=useState(0);
 const current=snapshot?.search===search&&snapshot?.page===page?snapshot.data:null;

 useEffect(()=>{
  let live=true,running=false;
  const abort=new AbortController();
  async function load(){
   if(running)return;
   running=true;
   setLoading(true);setError('');
   try{
    const {data,error}=await client.rpc('pitacco_owner_platform_dashboard',{p_search:search,p_page:page}).abortSignal(abort.signal);
    if(!live)return;
    if(error||!data?.billing||!data.orders||!data.couriers||!Array.isArray(data.stores))throw error||Error('Indicadores indisponíveis');
    setSnapshot({search,page,data});
   }catch{
    if(live)setError('Não foi possível atualizar os indicadores. Tente novamente.');
   }finally{
    running=false;
    if(live)setLoading(false);
   }
  }
  void load();
  const refreshVisible=()=>{if(document.visibilityState==='visible')void load();};
  const timer=setInterval(refreshVisible,60000);
  document.addEventListener('visibilitychange',refreshVisible);
  return()=>{live=false;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refreshVisible);};
 },[client,search,page,revision]);

 const stats=snapshot?.data;
 const pages=Math.max(1,Math.ceil((current?.matching_stores??0)/(current?.page_size??15)));
 const cards=stats&&[
  [Store,'Lojas cadastradas',stats.billing.registered,'Todos os estabelecimentos'],
  [ClipboardList,'Pedidos hoje',stats.orders_today,'Pedidos registrados no horário de Brasília'],
  [Clock3,'Pedidos em andamento',stats.orders.in_progress,'Do pedido recebido à entrega'],
  [Bike,'Entregadores cadastrados',stats.couriers.registered,number.format(stats.couriers.active)+' ativos · '+number.format(stats.couriers.shared)+' da frota compartilhada'],
  [Truck,'Entregas em andamento',stats.deliveries_in_progress,'Aguardando entregador ou em rota'],
 ];
 const stages=stats&&[
  ['Aguardando aceite',stats.orders.pending],['Em preparo',stats.orders.preparing],
  ['Prontos',stats.orders.ready],['Em entrega',stats.orders.delivering],['Agendados',stats.orders.scheduled],
 ];
 function filter(event){
  event.preventDefault();
  setSearch(draft.trim());setPage(0);
 }

 return <section className="owner-dashboard" aria-label="Visão geral do Pitacco">
  <div className="owner-dashboard-toolbar">
   <p>{stats?`Atualizado às ${time.format(new Date(stats.updated_at))} · horário de Brasília`:'Acompanhe a operação de todas as lojas.'}</p>
   <button type="button" className="secondary" disabled={loading} onClick={()=>refresh(value=>value+1)}>
    <RefreshCw size={16} aria-hidden="true"/>{loading?'Atualizando…':'Atualizar indicadores'}
   </button>
  </div>
  {error&&<p role="alert" className="panel notice error">{error}</p>}
  {!stats&&loading&&<p role="status">Carregando indicadores…</p>}
  {stats&&<>
   <div className="owner-dashboard-metrics" aria-label="Indicadores gerais">
    {cards.map(([Icon,label,value,detail])=><article key={label}>
     <span className="owner-dashboard-icon"><Icon size={20} aria-hidden="true"/></span>
     <span>{label}</span><strong>{number.format(value)}</strong><small>{detail}</small>
    </article>)}
   </div>
   <div className="owner-dashboard-details">
    <section className="panel" aria-label="Etapas dos pedidos">
     <h3>Etapas dos pedidos</h3>
     <dl>{stages.map(([label,value])=><div className="line" key={label}><dt>{label}</dt><dd>{number.format(value)}</dd></div>)}</dl>
    </section>
    <section className="panel" aria-label="Pedidos de hoje por canal">
     <h3>Pedidos de hoje por canal</h3>
     <dl>{Object.entries(channels).map(([key,label])=><div className="line" key={key}>
      <dt>{label}</dt><dd>{number.format(stats.channels[key]??0)}</dd>
     </div>)}</dl>
    </section>
    <section className="panel" aria-label="Indicadores de assinatura">
     <h3>Assinaturas</h3>
     <dl>
      {Object.entries(subscriptions).map(([key,label])=><div className="line" key={key}>
       <dt>{label}</dt><dd>{number.format(stats.billing[key])}</dd>
      </div>)}
      <div className="line"><dt>Receita mensal recorrente estimada</dt>
       <dd>{currency.format(stats.billing.monthly_recurring_revenue)}</dd></div>
     </dl>
    </section>
   </div>
   <section className="panel owner-dashboard-stores" aria-label="Operação por loja" aria-busy={loading}>
    <div className="owner-dashboard-toolbar">
     <h3>Operação por loja</h3>
     <form onSubmit={filter}>
      <label className="field">Nome da loja
       <input type="search" value={draft} maxLength={120} onChange={event=>setDraft(event.target.value)}/>
      </label>
      <button type="submit" className="secondary">Buscar</button>
     </form>
    </div>
    {!current&&loading&&<p role="status">Carregando lojas…</p>}
    {current&&current.stores.length===0&&<p>Nenhuma loja encontrada.</p>}
    {!!current?.stores.length&&<div className="owner-dashboard-table" tabIndex={0}>
     <table aria-label="Resumo dos estabelecimentos">
      <thead><tr><th scope="col">Loja</th><th scope="col">Pedidos hoje</th>
       <th scope="col">Em andamento</th><th scope="col">Agendados</th>
       <th scope="col">Entregas em andamento</th><th scope="col">Entregadores da loja</th>
       <th scope="col">Assinatura</th><th scope="col">Configuração</th></tr></thead>
      <tbody>{current.stores.map(store=><tr key={store.id}>
       <th scope="row">{store.name}</th><td>{number.format(store.orders_today)}</td>
       <td>{number.format(store.orders_in_progress)}</td><td>{number.format(store.scheduled)}</td>
       <td>{number.format(store.deliveries_in_progress)}</td><td>{number.format(store.couriers)}</td>
       <td>{subscriptions[store.subscription]||'—'}</td>
       <td><button type="button" className="secondary" aria-label={'Abrir configuração de '+store.name}
        onClick={()=>onStore(store.id)}>Abrir</button></td>
      </tr>)}</tbody>
     </table>
    </div>}
    {current&&pages>1&&<div className="owner-dashboard-pagination">
     <button type="button" className="secondary" disabled={loading||page===0} onClick={()=>setPage(page-1)}>Anterior</button>
     <span>Página {number.format(page+1)} de {number.format(pages)}</span>
     <button type="button" className="secondary" disabled={loading||page+1>=pages} onClick={()=>setPage(page+1)}>Próxima</button>
    </div>}
   </section>
  </>}
 </section>;
}
