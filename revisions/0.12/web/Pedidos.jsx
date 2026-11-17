import React,{useMemo,useState} from 'react';
import {Bike, CheckCircle2, ChefHat, Clock3, CreditCard, Printer, ShoppingBag, TrendingUp, UserRound} from 'lucide-react';
import './pedidos.css';
import {deliveryLabel,sourceLabel} from './DeliveryDialog.jsx';
import {receiptItems} from './receiptItems.mjs';
import {publicOrderNumber,validLocalizer} from './orderDisplay.mjs';
const scheduledTime=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const stages=[['scheduled','Agendados'],['analysis','Pendentes'],['preparing','Em preparo'],['ready','Prontos'],['delivery','Em entrega'],['completed','Concluídos'],['cancelled','Cancelados'],['rejected','Recusados']];
const summary=[['analysis','Pendentes',Clock3],['preparing','Em preparo',ChefHat],['ready','Prontos',ShoppingBag],['delivery','Em entrega',Bike],['completed','Concluídos',CheckCircle2]];
const terminal=new Set(['completed','cancelled','rejected']);
const brl=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const ifoodAcceptExpired=order=>order?.source==='ifood'&&Number.isFinite(Date.parse(order?.created_at))&&Date.now()-Date.parse(order.created_at)>=8*60*1000;
const readableModifiers=modifiers=>Array.isArray(modifiers)?modifiers.map(mod=>{
 if(typeof mod==='string')return mod.trim();
 if(!mod||typeof mod!=='object')return '';
 const name=typeof mod.name==='string'?mod.name.trim():'';
 if(!name)return '';
 const quantity=Number(mod.quantity);
 return (Number.isFinite(quantity)&&quantity>0?quantity:1)+' × '+name;
}).filter(Boolean).join(', '):'';

const deliveryType=(order,delivery)=>{
 const mode=delivery?.logistics_provider??order.receipt?.logistics;
 if(mode==='retirada')return {type:'pickup',label:'Retirada na loja'};
 if(mode==='marketplace')return {type:'partner',label:'Entrega via '+(sourceLabel(delivery?.source??order.source)||'parceiro')};
 if(mode==='loja')return {type:'own',label:delivery?.status==='retirada'&&delivery.arrived_at?deliveryLabel(delivery):'Entrega própria'};
 return {type:'unknown',label:'Logística a confirmar'};
};
const canAssign=(order,delivery)=>order.status==='accepted'&&delivery?.logistics_provider==='loja'&&delivery.status==='pendente'&&!delivery.courier_id;
function DeliveryBadge({order,delivery}){
 const {type,label}=deliveryType(order,delivery);
 return <span className="pedidos-delivery-badge" data-delivery={type}>{type==='pickup'?<ShoppingBag size={15} aria-hidden="true"/>:<Bike size={15} aria-hidden="true"/>}{label}</span>;
}
export default function Pedidos({orders=[],deliveries=[],badges=[],stage,onAccept,onAcceptIfood,onGetIfoodReasons,onRejectIfood,onDecision,onReady,onDetail,onAssign,onReprint,busy=false,merchantLayout=false,manualPrint=false}){
 const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[selected,setSelected]=useState(null),[decision,setDecision]=useState(null);
 const badgeByOrder=useMemo(()=>new Map(badges.map(b=>[b.order_id,b])),[badges]);
 const number=o=>publicOrderNumber(o,badgeByOrder.get(o?.id));
 const counts=useMemo(()=>Object.fromEntries(stages.map(([id])=>[id,orders.filter(o=>stage(o)===id).length])),[orders,stage]);
 const filtered=useMemo(()=>orders.filter(o=>(filter==='all'?!terminal.has(stage(o)):stage(o)===filter)&&(!search||[number(o),o.receipt?.customer,o.receipt?.phone,...receiptItems(o.receipt).map(i=>i.name)].join(' ').toLowerCase().includes(search.toLowerCase()))),[orders,filter,search,stage]);
 const current=filtered.find(o=>o.id===selected)||filtered[0];
 const deliveriesByOrder=useMemo(()=>new Map(deliveries.map(delivery=>[delivery.order_id,delivery])),[deliveries]);
 const currentDelivery=deliveriesByOrder.get(current?.id);
 const currentLocalizer=validLocalizer(badgeByOrder.get(current?.id));
 const canDecide=current?.source==='proprio'&&current.status==='pending';
 const waitingIfood=current?.source==='ifood'&&current.status==='pending';
 const ifoodRequestPending=waitingIfood&&current.receipt?.ifood_manual_accept==='requested';
 const ifoodExpired=waitingIfood&&ifoodAcceptExpired(current);
 const ifoodCancelPending=waitingIfood&&current.receipt?.ifood_manual_cancel==='requested';
 async function openIfoodReject(order){
  setSelected(order.id);
  setDecision({id:order.id,status:'ifood',reason:'',reasons:[],loading:true,error:''});
  try{
   const reasons=await onGetIfoodReasons(order.id);
   if(!Array.isArray(reasons)||!reasons.length)throw Error('O iFood não disponibilizou motivos de cancelamento para este pedido.');
   setDecision(previous=>previous?.id===order.id&&previous.status==='ifood'?
    {...previous,reasons,loading:false}:previous);
  }catch(error){
   setDecision(previous=>previous?.id===order.id&&previous.status==='ifood'?
    {...previous,error:error.message||'Não foi possível consultar motivos no iFood.',loading:false}:previous);
  }
 }
 const decisionApplies=canDecide&&decision?.id===current.id;
 const total=orders.filter(o=>!['cancelled','rejected'].includes(stage(o))).reduce((sum,o)=>sum+Number(o.gross||0),0);
 return <div className="pitacco-pedidos">
  <header className="pedidos-heading"><div><h2>Pedidos</h2><p>Acompanhe e processe os pedidos da sua loja.</p></div><span>Pedidos sincronizados com a loja</span></header>
  {merchantLayout?<div className="pedidos-kpis">{summary.map(([key,label,Icon])=><button key={key} className={'pedidos-kpi '+(filter===key?'selected':'')} onClick={()=>setFilter(key)}>
   <Icon size={23} aria-hidden="true"/><span><strong>{counts[key]}</strong>{label}</span>
  </button>)}<div className="pedidos-kpi"><TrendingUp size={23} aria-hidden="true"/><span><strong>{brl(total)}</strong>Total registrado*</span></div></div>:
  <div className="pedidos-kpis">{stages.map(([key,label])=><button key={key} className={'pedidos-kpi '+(filter===key?'selected':'')} onClick={()=>setFilter(key)}><strong>{counts[key]}</strong><span>{label}</span></button>)}<div className="pedidos-kpi"><strong>{brl(total)}</strong><span>Total registrado*</span></div></div>}
  <div className="pedidos-tabs"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>Em andamento</button>{stages.map(([key,label])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label} ({counts[key]})</button>)}<input aria-label="Buscar pedido, cliente ou item" placeholder="Buscar nome, telefone ou código…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
  <div className="pedidos-split"><div className="pedidos-list">{filtered.length===0&&<p>Nenhum pedido encontrado.</p>}{filtered.map(o=>{
   const delivery=deliveriesByOrder.get(o.id);
   const source=sourceLabel(o.source)||o.channel||'Loja';
   return <article key={o.id} aria-label={'Card do pedido '+number(o)} data-source={o.source}
    className={'pedidos-card order-card '+(current?.id===o.id?'selected':'')}>
    <button type="button" className="pedidos-card-select" aria-pressed={current?.id===o.id} onClick={()=>setSelected(o.id)}>
     <span className="pedidos-card-row"><b className="pedidos-origin">{source}</b><span className="store-stage" data-stage={stage(o)}>{stages.find(([id])=>id===stage(o))?.[1]||'Em andamento'}</span></span>
     <span className="pedidos-card-row"><b className="pedidos-number"><ShoppingBag size={17} aria-hidden="true"/> #{number(o)}</b>
      <small>{o.scheduled_for?'Agendado '+scheduledTime.format(new Date(o.scheduled_for)):o.created_at?new Date(o.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</small></span>
     <span className="pedidos-card-row"><span>{o.receipt?.customer||'Cliente'}</span><b>{brl(o.gross)}</b></span>
     {validLocalizer(badgeByOrder.get(o.id))&&<span className="pedidos-localizer" aria-label="Localizador de ligação do pedido"><strong>LOCALIZADOR</strong><b>{validLocalizer(badgeByOrder.get(o.id))}</b></span>}
     <DeliveryBadge order={o} delivery={delivery}/>
    </button>
    {o.source==='ifood'&&o.status==='pending'&&<div className="pedidos-card-actions">
     {o.receipt?.ifood_manual_cancel==='requested'?<span role="status">Cancelamento solicitado ao iFood</span>:
      o.receipt?.ifood_manual_accept==='requested'?<span role="status">Aguardando confirmação do iFood</span>:
      <>{!ifoodAcceptExpired(o)&&<button type="button" className="primary" disabled={busy||!onAcceptIfood} onClick={()=>onAcceptIfood?.(o.id)}>Aceitar pedido</button>}
      <button type="button" className="secondary" disabled={busy||!onRejectIfood||!onGetIfoodReasons} onClick={()=>void openIfoodReject(o)}>Recusar pedido</button></>}
    </div>}
    {(canAssign(o,delivery)||o.status==='accepted')&&<div className="pedidos-card-actions">
     {canAssign(o,delivery)&&<button type="button" className="secondary" disabled={busy} onClick={()=>onAssign(o)}>Selecionar entregador</button>}
     {o.status==='accepted'&&<button type="button" className="secondary pedidos-card-print" aria-label={(manualPrint?"Imprimir no navegador pedido ":"Reimprimir comanda do pedido ")+number(o)} disabled={busy} onClick={()=>onReprint(o.id)}><Printer size={16} aria-hidden="true"/></button>}
    </div>}
   </article>;
  })}</div>
  {current?<article className="pedidos-detail"><div className="pedidos-detail-heading"><h3><ShoppingBag size={23} aria-hidden="true"/> Pedido #{number(current)}</h3><span className="store-stage" data-stage={stage(current)}>{stages.find(([id])=>id===stage(current))?.[1]||'Em andamento'}</span></div>{currentLocalizer&&<div className="pedidos-localizer pedidos-localizer-detail"><strong>LOCALIZADOR DE LIGAÇÃO</strong><b>{currentLocalizer}</b></div>}<div className="pedidos-detail-pair"><section><h4><UserRound size={17} aria-hidden="true"/> Cliente</h4><strong>{current.receipt?.customer||'Não informado'}</strong><p>{current.receipt?.phone||''}</p><p>{current.receipt?.address||''}</p></section><section><h4><CreditCard size={17} aria-hidden="true"/> Pagamento</h4><p>{current.receipt?.payment||'Não informado'}</p><DeliveryBadge order={current} delivery={currentDelivery}/></section></div><section className="pedidos-items"><h4><ShoppingBag size={17} aria-hidden="true"/> Itens do pedido</h4>{receiptItems(current.receipt).map((item,i)=><div key={i}><span>{item.quantity||1} × {item.name}<small>{Array.isArray(item.modifiers)?readableModifiers(item.modifiers):''}</small></span><span>{item.total!=null?brl(item.total):''}</span></div>)}{current.receipt?.subtotal!=null&&<div><span>Subtotal</span><strong>{brl(current.receipt.subtotal)}</strong></div>}
  {current.receipt?.delivery_fee!=null&&<div><span>Taxa de entrega</span><strong>{brl(current.receipt.delivery_fee)}</strong></div>}
  <footer><b>Total</b><strong>{brl(current.gross)}</strong></footer></section><div className="pedidos-actions"><button onClick={()=>onDetail(current)}>Detalhes e entrega</button>{current.status==='accepted'&&<button disabled={busy} onClick={()=>onReprint(current.id)}>🖨️ {manualPrint?'Imprimir no navegador':'Reimprimir'}</button>}{canDecide&&<>
 {stage(current)==='scheduled'
  ? <p>Aceite liberado às {scheduledTime.format(new Date(current.scheduled_release_at))}.</p>
  : <button className="primary" disabled={busy} onClick={()=>onAccept(current.id)}>Aceitar pedido</button>}
 <button type="button" disabled={busy} onClick={()=>setDecision({id:current.id,status:'rejected',reason:''})}>Recusar pedido</button>
 <button type="button" disabled={busy} onClick={()=>setDecision({id:current.id,status:'cancelled',reason:''})}>Cancelar pedido</button>
 </>}{stage(current)==='preparing'&&current.source==='proprio'&&<button className="primary" disabled={busy} onClick={()=>onReady(current.id)}>Marcar pronto</button>}</div>{waitingIfood&&<div role="status">
 {ifoodCancelPending?<p>Cancelamento solicitado ao iFood. Aguardando o evento oficial CANCELLED.</p>:
 ifoodRequestPending?<p>Aguardando confirmação oficial do iFood. Não aceite novamente.</p>:
 ifoodExpired?<p>Prazo de aceite do iFood encerrado. Atualize o pedido ou gere outro teste.</p>:
 <><button className="primary" disabled={busy||!onAcceptIfood} onClick={()=>onAcceptIfood?.(current.id)}>Aceitar pedido no iFood</button>
 {current.receipt?.ifood_manual_accept==='failed'&&<p>O envio anterior falhou. É possível tentar novamente enquanto estiver no prazo.</p>}</>}
 {!ifoodRequestPending&&!ifoodCancelPending&&<button type="button" className="secondary" disabled={busy||!onRejectIfood||!onGetIfoodReasons} onClick={()=>void openIfoodReject(current)}>Recusar pedido no iFood</button>}
 {current.receipt?.ifood_manual_cancel==='failed'&&<p>O iFood não confirmou o cancelamento anterior. Consulte o motivo e tente novamente se permitido.</p>}
 </div>}{decision?.id===current.id&&decision.status==='ifood'&&<form onSubmit={async e=>{
 e.preventDefault();if(!decision.reason)return;
 await onRejectIfood(current.id,decision.reason);setDecision(null);
 }}>
 <h4>Recusar pedido no iFood</h4>
 <p>O pedido só será marcado como cancelado quando o iFood confirmar o cancelamento.</p>
 {decision.loading?<p>Consultando motivos disponíveis no iFood…</p>:
 decision.error?<p role="alert">{decision.error}</p>:
 <label>Motivo da recusa
 <select required value={decision.reason} onChange={event=>setDecision({...decision,reason:event.target.value})}>
 <option value="">Selecione o motivo</option>
 {decision.reasons.map(reason=><option key={reason.code} value={reason.code}>{reason.description}</option>)}
 </select>
 </label>}
 <button className="primary" disabled={busy||decision.loading||!decision.reason||Boolean(decision.error)}>Confirmar recusa no iFood</button>
 <button type="button" className="secondary" disabled={busy} onClick={()=>setDecision(null)}>Voltar</button>
 </form>}{decisionApplies&&<form onSubmit={async event=>{
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
