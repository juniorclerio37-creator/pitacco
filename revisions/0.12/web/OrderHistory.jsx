import React,{useEffect,useState} from 'react';
import {Search,CalendarDays,History,ChevronLeft,ChevronRight} from 'lucide-react';
import {businessDay} from './dailyOrders.mjs';
import {publicOrderNumber,orderAddress,validLocalizer} from './orderDisplay.mjs';
import {receiptItems} from './receiptItems.mjs';
import OrderDetails from './OrderDetails.jsx';
import './order-history.css';
const labels={analysis:'Em análise',preparing:'Em preparo',ready:'Pronto',delivery:'Em entrega',scheduled:'Agendado',completed:'Concluído',cancelled:'Cancelado',rejected:'Recusado',historical:'Histórico'};
const origin=o=>o.source==='proprio'?(String(o.receipt?.point_of_sale)==='true'?'Balcão':'Cardápio digital'):({ifood:'iFood','99food':'99Food',keeta:'Keeta'}[o.source]||o.source||'Loja');
const fmt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const defaults=()=>({from:businessDay(Date.now()-6*86400000),to:businessDay(),status:'all',origin:'all',query:''});
const PAGE=50;
const customerName=(o,d)=>o.receipt?.customer||d?.customer_name||'Cliente';
const customerPhone=(o,d)=>o.receipt?.phone||o.receipt?.customer_phone||d?.customer_phone||'';
const address=(o,d)=>orderAddress(d?.address)||orderAddress(o.receipt?.address||o.receipt?.delivery_address);
export default function OrderHistory({client,storeId}){
 const [draft,setDraft]=useState(defaults),[filter,setFilter]=useState(defaults),[page,setPage]=useState(0),[rows,setRows]=useState([]),[more,setMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(null),[revision,setRevision]=useState(0);
 const [courierName,setCourierName]=useState('');
 useEffect(()=>{let live=true;setCourierName('');const id=selected?.delivery_data?.courier_id;if(id)client.from('couriers').select('name').eq('store_id',storeId).eq('id',id).maybeSingle().then(({data,error})=>{if(live&&!error)setCourierName(data?.name||'')}).catch(()=>{});return()=>{live=false}},[client,storeId,selected]);
 const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
 useEffect(()=>{
  let live=true;setLoading(true);setError('');setRows([]);setMore(false);setSelected(null);
  client.rpc('pitacco_merchant_order_history',{p_store:storeId,p_from:filter.from,p_to:filter.to,p_status:filter.status,p_origin:filter.origin,p_query:filter.query,p_offset:page*PAGE})
  .then(({data,error})=>{if(!live)return;if(error)throw error;setRows((data||[]).slice(0,PAGE));setMore((data||[]).length>PAGE)})
  .catch(e=>{if(live)setError(e.message||'Não foi possível carregar o histórico.')})
  .finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[client,storeId,filter,page,revision]);
 function submit(e){e.preventDefault();if(!draft.from||!draft.to||draft.to<draft.from||(Date.parse(draft.to)-Date.parse(draft.from))/86400000>366){setError('Selecione um período válido de até 367 dias.');return;}setPage(0);setFilter({...draft});}
 function reset(){const f=defaults();setDraft(f);setFilter(f);setPage(0)}
 return <section className="order-history" aria-label="Histórico de pedidos">
 <header className="history-heading"><History size={25}/><div><h2>Histórico de pedidos</h2><p>Consulte os pedidos registrados pela sua loja, sem interferir na operação do dia.</p></div></header>
 <form className="history-filters" onSubmit={submit}>
 <label>Data inicial<input required type="date" value={draft.from} max={draft.to} onChange={e=>change('from',e.target.value)}/></label>
 <label>Data final<input required type="date" value={draft.to} min={draft.from} onChange={e=>change('to',e.target.value)}/></label>
 <label>Situação<select value={draft.status} onChange={e=>change('status',e.target.value)}><option value="all">Todas</option>{Object.entries(labels).filter(([k])=>k!=='rejected'&&k!=='historical').map(([k,v])=><option key={k} value={k}>{k==='cancelled'?'Cancelados e recusados':v}</option>)}</select></label>
 <label>Origem<select value={draft.origin} onChange={e=>change('origin',e.target.value)}>{[['all','Todas as plataformas'],['cardapio','Cardápio digital'],['balcao','Balcão'],['ifood','iFood'],['99food','99Food'],['keeta','Keeta']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <label className="history-search">Buscar pedido, cliente ou telefone<div><Search size={16}/><input maxLength={100} value={draft.query} onChange={e=>change('query',e.target.value)} placeholder="Número, nome ou telefone"/></div></label>
 <div className="history-filter-actions"><button type="button" className="secondary" onClick={reset}>Limpar</button><button type="submit" className="primary">Filtrar pedidos</button></div>
 </form>
 {error&&<p className="notice error" role="alert">{error} <button className="secondary" type="button" onClick={()=>setRevision(n=>n+1)}>Tentar novamente</button></p>}
 <div className="history-results"><div className="history-results-heading"><h3>Resultados</h3><span><CalendarDays size={14}/> {filter.from.split('-').reverse().join('/')} a {filter.to.split('-').reverse().join('/')}</span></div>
 {loading?<p role="status">Carregando pedidos…</p>:!rows.length?<p role="status">Nenhum pedido encontrado neste período.</p>:<div className="history-table-wrap"><table className="history-table"><thead><tr><th>Pedido</th><th>Cliente e contato</th><th>Modalidade / endereço</th><th>Origem</th><th>Data e hora</th><th>Total</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{rows.map(row=>{const o=row.order_data;return <tr key={o.id}><td><b>#{publicOrderNumber(o)}</b></td><td><b>{customerName(o,row.delivery_data)}</b>{customerPhone(o,row.delivery_data)&&<span className="history-contact">{customerPhone(o,row.delivery_data)}</span>}</td><td className="history-address">{o.receipt?.logistics==='retirada'?'Retirada na loja':address(o,row.delivery_data)||'Endereço não registrado'}</td><td>{origin(o)}</td><td>{fmt.format(new Date(o.created_at))}</td><td>{money.format(Number(o.gross||0))}</td><td><span className="history-status" data-stage={row.order_stage}>{labels[row.order_stage]||row.order_stage}</span></td><td><button type="button" className="secondary" onClick={()=>setSelected(row)}>Ver detalhes</button></td></tr>})}</tbody></table></div>}
 <footer className="history-pages"><span>Página {page+1} · {rows.length} pedido(s) exibidos</span><button type="button" className="secondary" disabled={loading||page===0} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={16}/> Anterior</button><button type="button" className="secondary" disabled={loading||!more} onClick={()=>setPage(n=>n+1)}>Próxima <ChevronRight size={16}/></button></footer></div>
 {selected&&<OrderDetails key={selected.order_data.id} order={selected.order_data} delivery={selected.delivery_data} historyMode={true} courierName={courierName} localizer={validLocalizer({localizer:selected.order_data.receipt?.localizer})} number={publicOrderNumber(selected.order_data)} stage={selected.order_stage} stageLabel={labels[selected.order_stage]||selected.order_stage} origin={origin(selected.order_data)} items={receiptItems(selected.order_data.receipt)} modifiers={mods=>Array.isArray(mods)?mods.map(m=>typeof m==='string'?m:m?.name?((Number(m.quantity)||1)+' × '+m.name):'').filter(Boolean).join(', '):''} deliveryBadge={<span>{selected.order_data.receipt?.logistics==='retirada'?'Retirada na loja':'Entrega'}</span>} onClose={()=>setSelected(null)} actions={<button type="button" className="secondary" onClick={()=>setSelected(null)}>Fechar</button>}><p>Data do pedido: {fmt.format(new Date(selected.order_data.created_at))}</p>{selected.reason&&<p className="notice">Motivo registrado: {selected.reason}</p>}</OrderDetails>}
 </section>
}
