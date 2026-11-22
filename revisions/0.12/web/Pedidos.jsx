import React,{useEffect,useMemo,useState} from 'react';
import {Bike, CheckCircle2, ChefHat, Clock3, Printer, ShoppingBag, TrendingUp} from 'lucide-react';
import './pedidos.css';
import FleetTracking from './FleetTracking.jsx';
import OrderDetails from './OrderDetails.jsx';
import {deliveryLabel,sourceLabel} from './DeliveryDialog.jsx';
import {receiptItems} from './receiptItems.mjs';
import {orderAddress,publicOrderNumber,validLocalizer} from './orderDisplay.mjs';
const scheduledTime=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
const stages=[['scheduled','Agendados'],['analysis','Em análise'],['preparing','Em preparo'],['ready','Pronto'],['delivery','Em entrega'],['completed','Concluído'],['cancelled','Cancelados'],['rejected','Recusados']];
const summary=[['analysis','Em análise',Clock3],['preparing','Em preparo',ChefHat],['ready','Prontos',ShoppingBag],['delivery','Em entrega',Bike],['completed','Concluídos',CheckCircle2]];
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
const canAssign=(order,delivery)=>order.status==='accepted'&&order.preparation_status==='ready'&&delivery?.logistics_provider==='loja'&&delivery.status==='pendente'&&!delivery.courier_id;
const isAutomaticDispatch=mode=>mode==='automatico';
const canDispatch=(order,delivery)=>canAssign(order,delivery);
const canConcludeOnWindows=(order,delivery,step)=>(
 order?.source==='proprio' && order?.status==='accepted' &&
 ( (order.receipt?.logistics==='retirada' && step==='ready') ||
   (delivery?.logistics_provider==='loja' && ['ready','delivery'].includes(step)) )
);
const canExecuteConclusion=(order,delivery,step)=>(
 order?.receipt?.logistics==='retirada'?step==='ready':
 step==='delivery'&&delivery?.logistics_provider==='loja'
);
// Identidade de origem local: sem imagens externas ou logotipos com carregamento remoto.
function PlatformIcon({source}){
 const value=String(source||'').toLowerCase();
 const platform=['99food','99','99_food','99-food'].includes(value)?'99food':value==='ifood'?'ifood':value==='keeta'?'keeta':value==='proprio'||value==='loja'||value==='cardapio'?'loja':'outros';
 const labels={ '99food':'99Food',ifood:'iFood',keeta:'Keeta',loja:'Loja',outros:'Outra origem'};
 const mark=platform==='99food'?'99':platform==='ifood'?'iF':platform==='keeta'?'K':<ShoppingBag size={14} aria-hidden="true"/>;
 return <span className="pedidos-platform-icon" data-platform={platform} role="img" aria-label={'Plataforma '+labels[platform]}>{mark}</span>;
}
function cardPayment(order){
 const receipt=order?.receipt||{},status=String(receipt.payment_status||'').toLowerCase();
 const method=String(receipt.payment_method||receipt.payment||'');
 if(receipt.payment==='fiado')return {state:'fiado',label:'Fiado · a receber'};
 if(receipt.payment_confirmed===true||receipt.paid===true||['paid','approved','captured','settled'].includes(status))
  return {state:'paid',label:'Pago'};
 if(receipt.payment_on_delivery===true||receipt.collect_on_delivery===true||/dinheiro|cash|na entrega/i.test(method))
  return {state:'collect',label:'A cobrar'};
 return {state:'review',label:'Pagamento a conferir'};
}
function DeliveryBadge({order,delivery}){
 const {type,label}=deliveryType(order,delivery);
 return <span className="pedidos-delivery-badge" data-delivery={type}>{type==='pickup'?<ShoppingBag size={15} aria-hidden="true"/>:<Bike size={15} aria-hidden="true"/>}{label}</span>;
}
export default function Pedidos({client,storeId,orders=[],deliveries=[],couriers=[],badges=[],stage,onAccept,onAcceptIfood,onGetIfoodReasons,onRejectIfood,onDecision,onReady,onPickup,onConclude,onDetail,onAssign,onReprint,busy=false,actionError,merchantLayout=false,popupLayout=false,manualPrint=false,acceptMode='manual',dispatchMode='manual'}){
 const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[selected,setSelected]=useState(null),[decision,setDecision]=useState(null);
 const [layout,setLayout]=useState('columns');
 const badgeByOrder=useMemo(()=>new Map(badges.map(b=>[b.order_id,b])),[badges]);
 const number=o=>publicOrderNumber(o,badgeByOrder.get(o?.id));
 const counts=useMemo(()=>Object.fromEntries(stages.map(([id])=>[id,orders.filter(o=>stage(o)===id).length])),[orders,stage]);
 const filtered=useMemo(()=>orders.filter(o=>(filter==='all'?!terminal.has(stage(o)):stage(o)===filter)&&(!search||[number(o),o.receipt?.customer,o.receipt?.phone,...receiptItems(o.receipt).map(i=>i.name)].join(' ').toLowerCase().includes(search.toLowerCase()))),[orders,filter,search,stage]);
 const current=orders.find(o=>o.id===selected);
 const closeDetails=()=>{setSelected(null);setDecision(null)};
 useEffect(()=>{closeDetails()},[storeId]);
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
 const decisionApplies=canDecide&&decision?.id===current.id&&decision.status!=='ifood';
 const total=orders.filter(o=>!['cancelled','rejected'].includes(stage(o))).reduce((sum,o)=>sum+Number(o.gross||0),0); 
 // Agrupamento visual por etapa; a classificação continua sendo calculada a
 // partir dos estados confirmados do pedido e da coleta, não por drag-and-drop.
 const boardStages=[['analysis','Em análise'],['preparing','Em preparo'],['ready','Pronto'],['delivery','Em entrega']];
 const auxiliaryStages=[['scheduled','Agendados'],['historical','Outros']];
 const boardGroups=popupLayout&&filter==='all'?
  [...boardStages,...auxiliaryStages.filter(([key])=>filtered.some(o=>stage(o)===key))].map(([id,label])=>({
   id,label,items:filtered.filter(o=>stage(o)===id)
  })):
  [{id:'all',label:'',items:filtered}];

 return <div className={"pitacco-pedidos"+(popupLayout?" windows-cards-only":"")} data-layout={!popupLayout&&client&&storeId?layout:"columns"}>
  <header className="pedidos-heading"><div><h2>Pedidos</h2><p>Acompanhe e processe os pedidos da sua loja.</p></div><span>Pedidos sincronizados com a loja</span></header>
  {!popupLayout&&client&&storeId&&<nav className="pedidos-layout-switch" aria-label="Visualização dos pedidos">
   <button type="button" className={layout==='columns'?'active':''} aria-pressed={layout==='columns'} onClick={()=>setLayout('columns')}>Colunas</button>
   <button type="button" className={layout==='routes'?'active':''} aria-pressed={layout==='routes'} onClick={()=>setLayout('routes')}>Roteirização</button>
  </nav>}
  {!popupLayout&&client&&storeId&&layout==='routes'&&<FleetTracking client={client} storeId={storeId} onBack={()=>setLayout('columns')}/>}

  {merchantLayout?<div className="pedidos-kpis">{summary.map(([key,label,Icon])=><button key={key} className={'pedidos-kpi '+(filter===key?'selected':'')} onClick={()=>setFilter(key)}>
   <Icon size={23} aria-hidden="true"/><span><strong>{counts[key]}</strong>{label}</span>
  </button>)}<div className="pedidos-kpi"><TrendingUp size={23} aria-hidden="true"/><span><strong>{brl(total)}</strong>Total registrado*</span></div></div>:
  <div className="pedidos-kpis">{stages.map(([key,label])=><button key={key} className={'pedidos-kpi '+(filter===key?'selected':'')} onClick={()=>setFilter(key)}><strong>{counts[key]}</strong><span>{label}</span></button>)}<div className="pedidos-kpi"><strong>{brl(total)}</strong><span>Total registrado*</span></div></div>}
  <div className="pedidos-tabs"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>Em andamento</button>{(popupLayout?stages.filter(([key])=>['analysis','preparing','ready','delivery','completed'].includes(key)):stages).map(([key,label])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label} ({counts[key]})</button>)}<input aria-label="Buscar pedido, cliente ou item" placeholder="Buscar nome, telefone ou código…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
  <div className="pedidos-split"><div className={"pedidos-list"+(popupLayout&&filter==='all'?" pedidos-kanban":"")}>
   {filtered.length===0&&<p>Nenhum pedido encontrado.</p>}
   {boardGroups.map(group=><section className="pedidos-stage-column" data-stage={group.id} key={group.id}>
    {popupLayout&&filter==='all'&&<header className="pedidos-stage-title"><strong>{group.label}</strong><span>{group.items.length}</span></header>}
    {popupLayout&&filter==='all'&&group.items.length===0&&<p className="pedidos-stage-empty">Nenhum pedido aqui</p>}
    {group.items.map(o=>{
   const delivery=deliveriesByOrder.get(o.id);
   const source=sourceLabel(o.source)||o.channel||'Loja';
   const items=receiptItems(o.receipt);
   const firstItem=items[0];
   const address=orderAddress(delivery?.address)||orderAddress(o.receipt?.address||o.receipt?.delivery_address);
   return <article key={o.id} aria-label={'Card do pedido '+number(o)} data-source={o.source}
    className={'pedidos-card order-card '+(current?.id===o.id?'selected':'')}>
    <button type="button" className="pedidos-card-select" aria-haspopup="dialog" aria-expanded={current?.id===o.id} onClick={()=>setSelected(o.id)}>
     <span className="pedidos-card-row"><b className="pedidos-origin"><PlatformIcon source={o.source}/><span>{source}</span></b><span className="store-stage" data-stage={stage(o)}>{stages.find(([id])=>id===stage(o))?.[1]||'Em andamento'}</span></span>
     <span className="pedidos-card-row"><b className="pedidos-number"><ShoppingBag size={17} aria-hidden="true"/> #{number(o)}</b>
      <small>{o.scheduled_for?'Agendado '+scheduledTime.format(new Date(o.scheduled_for)):o.created_at?new Date(o.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</small></span>
     <span className="pedidos-card-row"><span>{o.receipt?.customer||'Cliente'}</span><b>{brl(o.gross)}</b></span>
     {(o.receipt?.phone||o.receipt?.customer_phone)&&<span className="pedidos-card-row pedidos-card-contact"><span>{o.receipt?.phone||o.receipt?.customer_phone}</span></span>}
     {address&&<span className="pedidos-card-row pedidos-card-address"><span>{address}</span></span>}
     {merchantLayout&&firstItem&&<span className="pedidos-card-item">
      {firstItem.quantity||1} × {firstItem.name}{items.length>1&&<small> +{items.length-1} {items.length===2?'outro':'outros'}</small>}
     </span>}
     <span className="pedidos-card-row pedidos-card-info"><small>{items.reduce((n,item)=>n+(Number(item.quantity)||1),0)} item(ns)</small><span className="pedidos-payment-pill" data-payment={cardPayment(o).state}>{cardPayment(o).label}</span></span>
     {validLocalizer(badgeByOrder.get(o.id))&&<span className="pedidos-localizer" aria-label="Localizador de ligação do pedido"><strong>LOCALIZADOR</strong><b>{validLocalizer(badgeByOrder.get(o.id))}</b></span>}
     <DeliveryBadge order={o} delivery={delivery}/>
    </button>
    {o.source==='proprio'&&o.status==='pending'&&stage(o)==='analysis'&&<div className="pedidos-card-actions">
     <button type="button" className="primary pedidos-step-button" disabled={busy} onClick={()=>onAccept(o.id)}>Aceitar</button>
    </div>}
    {o.source==='ifood'&&o.status==='pending'&&<div className="pedidos-card-actions">
     <button type="button" className="primary" disabled={busy||o.status!=='pending'||acceptMode==='automatic'||!onAcceptIfood||ifoodAcceptExpired(o)||o.receipt?.ifood_manual_accept==='requested'||o.receipt?.ifood_manual_cancel==='requested'} onClick={()=>onAcceptIfood?.(o.id)}>Aceitar</button>
     <button type="button" className="secondary" disabled={busy||o.status!=='pending'||acceptMode==='automatic'||!onRejectIfood||!onGetIfoodReasons||o.receipt?.ifood_manual_accept==='requested'||o.receipt?.ifood_manual_cancel==='requested'} onClick={()=>void openIfoodReject(o)}>Recusar</button>
     {o.status==='pending'&&acceptMode==='automatic'&&<span role="status">Aceite automático ativo · aguardando iFood</span>}
     {o.receipt?.ifood_manual_accept==='requested'&&<span role="status">Aguardando confirmação do iFood</span>}
     {o.receipt?.ifood_manual_cancel==='requested'&&<span role="status">Cancelamento solicitado ao iFood</span>}
    </div>}
    {o.status==='accepted'&&<div className="pedidos-card-actions">
     {stage(o)==='preparing'&&<button type="button" className="primary pedidos-step-button" disabled={busy} onClick={()=>onReady(o.id)}>{popupLayout?'Marcar pronto':'Marcar pedido pronto'}</button>}
     {stage(o)==='ready'&&o.source==='proprio'&&o.receipt?.logistics==='retirada'&&!popupLayout&&<button type="button" className="primary pedidos-step-button" disabled={busy||!onPickup} onClick={()=>onPickup?.(o.id)}>Confirmar retirada</button>}
     {stage(o)==='ready'&&canDispatch(o,delivery,dispatchMode)&&<button type="button" className="primary pedidos-step-button" disabled={busy} onClick={()=>onAssign(o)}>{popupLayout?'Despachar':'Selecionar entregador'}</button>}
     {stage(o)==='ready'&&canAssign(o,delivery)&&isAutomaticDispatch(dispatchMode)&&<span role="status">Atribuição automática ativa · seleção manual também disponível</span>}
     {stage(o)==='ready'&&delivery?.courier_id&&<span role="status">Entregador selecionado · aguardando saída</span>}
     {stage(o)==='ready'&&delivery?.logistics_provider==='marketplace'&&<span role="status">Aguardando coleta pelo parceiro</span>}
     {stage(o)==='delivery'&&o.source==='proprio'&&delivery?.logistics_provider==='loja'&&!popupLayout&&<button type="button" className="primary pedidos-step-button" disabled={busy||!onConclude} onClick={()=>onConclude?.(o.id)}>Concluir entrega</button>}
     {stage(o)==='delivery'&&<button type="button" className="secondary pedidos-step-button" disabled={busy} onClick={()=>onDetail(o)}>Acompanhar entrega</button>}
     {popupLayout&&canConcludeOnWindows(o,delivery,stage(o))&&<button
       type="button" className="secondary pedidos-complete-button"
       disabled={busy||!canExecuteConclusion(o,delivery,stage(o))||
         !(o.receipt?.logistics==='retirada'?onPickup:onConclude)}
       title={canExecuteConclusion(o,delivery,stage(o))?
         (o.receipt?.logistics==='retirada'?'Registrar retirada concluída':'Concluir somente após chegada e comprovação da entrega'):
         'Aguarde a saída e a comprovação da entrega antes de concluir'}
       onClick={()=>o.receipt?.logistics==='retirada'?onPickup?.(o.id):onConclude?.(o.id)}>
       <CheckCircle2 size={16} aria-hidden="true"/> Concluir
      </button>}
     <button type="button" className="secondary pedidos-card-print" aria-label={(manualPrint?"Imprimir no navegador pedido ":"Reimprimir comanda do pedido ")+number(o)} disabled={busy} onClick={()=>onReprint(o.id)}><Printer size={16} aria-hidden="true"/></button>
    </div>}
   </article>;
  })}</section>)}</div>
  </div>
  {current&&<OrderDetails key={current.id} order={current} delivery={currentDelivery} number={number(current)}
   stage={stage(current)} stageLabel={stages.find(([id])=>id===stage(current))?.[1]||'Em andamento'}
   platform={<PlatformIcon source={current.source}/>} origin={sourceLabel(current.source)||current.channel||'Loja'}
   localizer={currentLocalizer} items={receiptItems(current.receipt)} modifiers={readableModifiers}
   deliveryBadge={<DeliveryBadge order={current} delivery={currentDelivery}/>}
   courierName={couriers.find(courier=>courier.id===currentDelivery?.courier_id)?.name}
   onClose={closeDetails} actionError={actionError}
   decisionOpen={decision?.id===current.id} actions={<>
{(currentDelivery||current.receipt?.logistics!=='retirada')&&<button className="secondary" onClick={()=>onDetail(current)}>Entrega e entregador</button>}
{current.status==='accepted'&&<button className="secondary" disabled={busy} onClick={()=>onReprint(current.id)}>🖨️ {manualPrint?'Imprimir no navegador':'Reimprimir'}</button>}
{stage(current)==='preparing'&&current.status==='accepted'&&<button className="primary" disabled={busy} onClick={()=>onReady(current.id)}>{popupLayout?'Marcar pronto':'Marcar pedido pronto'}</button>}
{stage(current)==='ready'&&current.source==='proprio'&&current.receipt?.logistics==='retirada'&&<button className="primary" disabled={busy||!onPickup} onClick={()=>onPickup?.(current.id)}>Confirmar retirada</button>}
{stage(current)==='ready'&&canDispatch(current,currentDelivery,dispatchMode)&&<button className="primary" disabled={busy} onClick={()=>onAssign(current)}>{popupLayout?'Despachar':'Selecionar entregador'}</button>}
{stage(current)==='delivery'&&current.source==='proprio'&&<button className="primary" disabled={busy||!onConclude} onClick={()=>onConclude?.(current.id)}>Concluir entrega</button>}
{canDecide&&<>
 {stage(current)!=='scheduled'&&<button className="primary" disabled={busy} onClick={()=>onAccept(current.id)}>Aceitar e iniciar preparo</button>}
 <button type="button" className="secondary" disabled={busy} onClick={()=>setDecision({id:current.id,status:'rejected',reason:''})}>Recusar pedido</button>
 <button type="button" className="secondary" disabled={busy} onClick={()=>setDecision({id:current.id,status:'cancelled',reason:''})}>Cancelar pedido</button>
 </>}{waitingIfood&&!ifoodRequestPending&&!ifoodCancelPending&&acceptMode!=='automatic'&&<>
 { !ifoodExpired&&<button className="primary" disabled={busy||!onAcceptIfood} onClick={()=>onAcceptIfood?.(current.id)}>Aceitar pedido no iFood</button>}
 <button type="button" className="secondary" disabled={busy||!onRejectIfood||!onGetIfoodReasons} onClick={()=>void openIfoodReject(current)}>Recusar pedido no iFood</button>
 </>}
  </>}>
{stage(current)==='ready'&&currentDelivery?.courier_id&&<p role="status" className="order-detail-note">Entregador atribuído · aguardando saída</p>}
{stage(current)==='ready'&&currentDelivery?.logistics_provider==='marketplace'&&<p role="status" className="order-detail-note">Aguardando retirada pelo parceiro</p>}
{stage(current)==='delivery'&&<p role="status" className="order-detail-note">A conclusão exige chegada e comprovação registradas pelo entregador; pedidos de marketplaces aguardam a confirmação oficial.</p>}
{canAssign(current,currentDelivery)&&isAutomaticDispatch(dispatchMode)&&<p role="status" className="order-detail-note">Atribuição automática ativa · você pode selecionar manualmente</p>}
{canDecide&&stage(current)==='scheduled'&&<p className="order-detail-note">Aceite liberado às {scheduledTime.format(new Date(current.scheduled_release_at))}.</p>}
{waitingIfood&&<div role="status" className="order-detail-meta">
 {ifoodCancelPending?<p>Cancelamento solicitado ao iFood. Aguardando confirmação oficial.</p>:
 ifoodRequestPending?<p>Aguardando confirmação oficial do iFood. Não aceite novamente.</p>:
 acceptMode==='automatic'?<p>Aceite automático ativo. Aguardando o iFood.</p>:
 ifoodExpired?<p>Prazo de aceite do iFood encerrado.</p>:null}
 {current.receipt?.ifood_manual_accept==='failed'&&<p>O envio anterior falhou. Tente novamente se o prazo ainda estiver aberto.</p>}
 {current.receipt?.ifood_manual_cancel==='failed'&&<p>O iFood não confirmou o cancelamento anterior. Consulte o motivo e tente novamente se permitido.</p>}
</div>}{decision?.id===current.id&&decision.status==='ifood'&&<form className="order-detail-decision" tabIndex={-1} onSubmit={async e=>{
 e.preventDefault();if(!decision.reason)return;
 const completed=await onRejectIfood(current.id,decision.reason);if(completed)setDecision(null);
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
 </form>}{decisionApplies&&<form className="order-detail-decision" tabIndex={-1} onSubmit={async event=>{
 event.preventDefault();
 await onDecision(current.id,decision.status,decision.reason);
 }}>
 <label>Motivo {decision.status==='rejected'?'da recusa':'do cancelamento'}
 <input required minLength={3} maxLength={240} value={decision.reason} onChange={event=>setDecision({...decision,reason:event.target.value})}/>
 </label>
 <button disabled={busy||decision.reason.trim().length<3}>{decision.status==='rejected'?'Confirmar recusa':'Confirmar cancelamento'}</button>
 <button type="button" disabled={busy} className="secondary" onClick={()=>setDecision(null)}>Voltar</button>
 </form>}
  </OrderDetails>}
  <small>*Total de pedidos carregados, não necessariamente faturamento do dia.</small>
 </div>
}
