import React,{useMemo,useState} from 'react';
import {Bike, CheckCircle2, ChefHat, Clock3, CreditCard, ShoppingBag, TrendingUp, UserRound} from 'lucide-react';
import './pedidos.css';
import {receiptItems} from './receiptItems.mjs';
const scheduledTime=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const stages=[['scheduled','Agendados'],['analysis','Pendentes'],['preparing','Em preparo'],['ready','Prontos'],['delivery','Em entrega'],['completed','Concluídos'],['cancelled','Cancelados'],['rejected','Recusados']];
const summary=[['analysis','Pendentes',Clock3],['preparing','Em preparo',ChefHat],['ready','Prontos',ShoppingBag],['delivery','Em entrega',Bike],['completed','Concluídos',CheckCircle2]];
const terminal=new Set(['completed','cancelled','rejected']);
const brl=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const number=o=>o.receipt?.display_number||o.receipt?.external_order_number||o.receipt?.order_number||o.receipt?.number||'Pendente';
export default function Pedidos({orders=[],stage,onAccept,onDecision,onReady,onDetail,onReprint,busy=false,merchantLayout=false}){
 const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[selected,setSelected]=useState(null),[decision,setDecision]=useState(null);
 const counts=useMemo(()=>Object.fromEntries(stages.map(([id])=>[id,orders.filter(o=>stage(o)===id).length])),[orders,stage]);
 const filtered=useMemo(()=>orders.filter(o=>(filter==='all'?!terminal.has(stage(o)):stage(o)===filter)&&(!search||[number(o),o.receipt?.customer,...receiptItems(o.receipt).map(i=>i.name)].join(' ').toLowerCase().includes(search.toLowerCase()))),[orders,filter,search,stage]);
 const current=filtered.find(o=>o.id===selected)||filtered[0];
 const canDecide=current?.source==='proprio'&&current.status==='pending';
 const waitingIfood=current?.source==='ifood'&&current.status==='pending';
 const decisionApplies=canDecide&&decision?.id===current.id;
 const total=orders.filter(o=>!['cancelled','rejected'].includes(stage(o))).reduce((sum,o)=>sum+Number(o.gross||0),0);
 return <div className="pitacco-pedidos">
  <header className="pedidos-heading"><div><h2>Pedidos</h2><p>Acompanhe e processe os pedidos da sua loja.</p></div><span>Pedidos sincronizados com a loja</span></header>
  {merchantLayout?<div className="pedidos-kpis">{summary.map(([key,label,Icon])=><button key={key} className={'pedidos-kpi '+(filter===key?'selected':'')} onClick={()=>setFilter(key)}>
   <Icon size={23} aria-hidden="true"/><span><strong>{counts[key]}</strong>{label}</span>
  </button>)}<div className="pedidos-kpi"><TrendingUp size={23} aria-hidden="true"/><span><strong>{brl(total)}</strong>Total registrado*</span></div></div>:
  <div className="pedidos-kpis">{stages.map(([key,label])=><button key={key} className={'pedidos-kpi '+(filter===key?'selected':'')} onClick={()=>setFilter(key)}><strong>{counts[key]}</strong><span>{label}</span></button>)}<div className="pedidos-kpi"><strong>{brl(total)}</strong><span>Total registrado*</span></div></div>}
  <div className="pedidos-tabs"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>Em andamento</button>{stages.map(([key,label])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label} ({counts[key]})</button>)}<input aria-label="Buscar pedido, cliente ou item" placeholder="Buscar pedido, cliente ou item…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
  <div className="pedidos-split"><div className="pedidos-list">{filtered.length===0&&<p>Nenhum pedido encontrado.</p>}{filtered.map(o=><div role="button" tabIndex={0} key={o.id} className={'pedidos-card order-card '+(current?.id===o.id?'selected':'')} onClick={()=>setSelected(o.id)} onKeyDown={e=>{if(e.key==='Enter'){setSelected(o.id)}}}><span><b className="pedidos-number"><ShoppingBag size={17} aria-hidden="true"/> #{number(o)}</b><small>{o.scheduled_for?'Agendado '+scheduledTime.format(new Date(o.scheduled_for)):o.created_at?new Date(o.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</small></span><span>{o.receipt?.customer||'Cliente'} <b>{brl(o.gross)}</b></span><small><span className="store-stage" data-stage={stage(o)}>{stages.find(([id])=>id===stage(o))?.[1]||'Em andamento'}</span> · {o.channel||o.source||'Loja'}</small>{o.status==='accepted'&&<button type="button" aria-label={"Reimprimir comanda do pedido "+number(o)} disabled={busy} onClick={e=>{e.stopPropagation();onReprint(o.id)}}>🖨️</button>}</div>)}</div>
  {current?<article className="pedidos-detail"><div className="pedidos-detail-heading"><h3><ShoppingBag size={23} aria-hidden="true"/> Pedido #{number(current)}</h3><span className="store-stage" data-stage={stage(current)}>{stages.find(([id])=>id===stage(current))?.[1]||'Em andamento'}</span></div><div className="pedidos-detail-pair"><section><h4><UserRound size={17} aria-hidden="true"/> Cliente</h4><strong>{current.receipt?.customer||'Não informado'}</strong><p>{current.receipt?.phone||''}</p><p>{current.receipt?.address||''}</p></section><section><h4><CreditCard size={17} aria-hidden="true"/> Pagamento</h4><p>{current.receipt?.payment||'Não informado'}</p><p>{current.receipt?.logistics==='retirada'?'Retirada':'Entrega'}</p></section></div><section className="pedidos-items"><h4><ShoppingBag size={17} aria-hidden="true"/> Itens do pedido</h4>{receiptItems(current.receipt).map((item,i)=><div key={i}><span>{item.quantity||1} × {item.name}<small>{Array.isArray(item.modifiers)?item.modifiers.join(', '):''}</small></span><span>{item.total!=null?brl(item.total):''}</span></div>)}{current.receipt?.subtotal!=null&&<div><span>Subtotal</span><strong>{brl(current.receipt.subtotal)}</strong></div>}
  {current.receipt?.delivery_fee!=null&&<div><span>Taxa de entrega</span><strong>{brl(current.receipt.delivery_fee)}</strong></div>}
  <footer><b>Total</b><strong>{brl(current.gross)}</strong></footer></section><div className="pedidos-actions"><button onClick={()=>onDetail(current)}>Detalhes e entrega</button>{current.status==='accepted'&&<button disabled={busy} onClick={()=>onReprint(current.id)}>🖨️ Reimprimir</button>}{canDecide&&<>
 {stage(current)==='scheduled'
  ? <p>Aceite liberado às {scheduledTime.format(new Date(current.scheduled_release_at))}.</p>
  : <button className="primary" disabled={busy} onClick={()=>onAccept(current.id)}>Aceitar pedido</button>}
 <button type="button" disabled={busy} onClick={()=>setDecision({id:current.id,status:'rejected',reason:''})}>Recusar pedido</button>
 <button type="button" disabled={busy} onClick={()=>setDecision({id:current.id,status:'cancelled',reason:''})}>Cancelar pedido</button>
 </>}{stage(current)==='preparing'&&current.source==='proprio'&&<button className="primary" disabled={busy} onClick={()=>onReady(current.id)}>Marcar pronto</button>}</div>{waitingIfood&&<p>Confirme o pedido no Gestor de Pedidos do iFood. O status será atualizado aqui.</p>}{decisionApplies&&<form onSubmit={async event=>{
 event.preventDefault();
 await onDecision(current.id,decision.status,decision.reason);
 }}>
 <label>Motivo {decision.status==='rejected'?'da recusa':'do cancelamento'}
 <input required minLength={3} maxLength={240} value={decision.reason} onChange={event=>setDecision({...decision,reason:event.target.value})}/>
 </label>
 <button disabled={busy||decision.reason.trim().length<3}>{decision.status==='rejected'?'Confirmar recusa':'Confirmar cancelamento'}</button>
 <button type="button" disabled={busy} className="secondary" onClick={()=>setDecision(null)}>Voltar</button>
 </form>}</article>:<div className="pedidos-detail">Selecione um pedido para ver os detalhes.</div>}</div><small>*Total de pedidos carregados, não necessariamente faturamento do dia.</small>
 </div>
}
