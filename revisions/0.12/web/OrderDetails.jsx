import React,{useEffect,useRef} from 'react';
import {Clock3,CreditCard,MapPin,Navigation,Phone,ShoppingBag,X} from 'lucide-react';
import {orderAddress,historyCustomer} from './orderDisplay.mjs';
import {scheduleInfo} from './scheduleInfo.mjs';

const money=value=>Number(value??0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const text=value=>typeof value==='string'?value.trim():'';
const amount=value=>{
 if(value==null||value==='')return null;
 const normalized=String(value).trim().replace(/^R\$\s*/,'');
 const number=Number(normalized.includes(',')?normalized.replace(/\./g,'').replace(',','.'):normalized);
 return Number.isFinite(number)&&number>=0?number:null;
};
const paymentNames={dinheiro:'Dinheiro',cash:'Dinheiro',pix:'Pix',pix_manual:'Pix manual',
 cartao:'Cartão',cartao_credito:'Cartão de crédito',cartao_debito:'Cartão de débito',
 credit_card:'Cartão de crédito',debit_card:'Cartão de débito',online:'Online'};

export default function OrderDetails({order,delivery,number,stage,stageLabel,platform,origin,localizer,items,
 modifiers,deliveryBadge,courierName,onClose,actions,actionError,decisionOpen,children,historyMode=false}){
 const ref=useRef(null), closeRef=useRef(null);
 useEffect(()=>{
  const dialog=ref.current, trigger=document.activeElement;
  dialog.showModal();
  closeRef.current.focus();
  return()=>{dialog.close();if(trigger?.isConnected)trigger.focus()};
 },[]);
 useEffect(()=>{
  if(decisionOpen)ref.current.querySelector('.order-detail-decision')?.focus();
 },[decisionOpen]);
 const receipt=order.receipt??{};
 const address=orderAddress(delivery?.address)||orderAddress(receipt.address||receipt.delivery_address);
 const historicalCustomer=historyMode?historyCustomer(order,delivery):null;
 const phone=historicalCustomer?historicalCustomer.phone:text(receipt.phone)||text(receipt.customer_phone);
 const dial=phone.replace(/[^+0-9]/g,'');
 const time=Date.parse(order.created_at);
 const schedule=scheduleInfo(order);
 const method=text(receipt.payment_method)||text(receipt.payment)||text(receipt.payment?.method)||text(receipt.payment_type);
 const timing=[receipt.payment_timing,receipt.payment_when,receipt.payment_location,receipt.payment_channel].map(text).join(' ');
 const state=text(receipt.payment_status||receipt.payment?.status).toLowerCase();
 const courierReceived=receipt.courier_collection?.received===true;
 const paid=courierReceived||receipt.payment_confirmed===true||receipt.paid===true||receipt.is_paid===true||
  ['paid','approved','captured','confirmed','settled'].includes(state);
 const pickup=(delivery?.logistics_provider??receipt.logistics)==='retirada';
 const collect=receipt.payment_on_delivery!==false&&receipt.collect_on_delivery!==false&&
  (receipt.payment_on_delivery===true||receipt.collect_on_delivery===true||/entrega|delivery|offline|on.arrival/i.test(timing)||
   (/dinheiro|cash|na entrega/i.test(method)&&!/online|prepaid|pré.pago/i.test(timing)));
 const due=amount(receipt.amount_to_collect??receipt.amount_due??order.gross);
 const changeFor=amount(receipt.change_for??receipt.cash_given??receipt.troco_para);
 const showCollection=!pickup&&(historyMode||!paid)&&collect&&due!==null;
 const receivedAmount=amount(receipt.courier_collection?.amount);
 const receivedAt=Date.parse(receipt.courier_collection?.received_at);
 const historicalChange=historyMode&&changeFor!==null;
 const historicalFee=historyMode?amount(receipt.delivery_fee_original):null;
 const note=text(receipt.notes)||text(receipt.observations)||text(receipt.observacao);
 const courier=text(courierName)||text(delivery?.courier_name)||text(delivery?.courier?.name);
 const route=address&&!pickup?'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address):'';
 return <dialog ref={ref} className="pedidos-order-dialog pedidos-detail-modal" aria-labelledby="pedidos-detail-title"
  onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
  <div className="order-detail-surface">
   <header className="order-detail-header">
    <div className="order-detail-heading">
     {platform}
     <div><div className="order-detail-origin">{origin}</div><h3 id="pedidos-detail-title">Pedido #{number}</h3>
      {Number.isFinite(time)&&<time dateTime={order.created_at}><Clock3 size={13} aria-hidden="true"/>
       {new Date(time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'})}</time>}
     </div>
    </div>
    <span className="store-stage" data-stage={stage}>{stageLabel}</span>
    <button ref={closeRef} type="button" className="secondary pedidos-modal-close" aria-label="Fechar detalhes do pedido" onClick={onClose}><X size={20} aria-hidden="true"/></button>
   </header>
   <div className="order-detail-body">
    <section className="order-detail-customer" aria-label="Cliente">
     <div><p className="order-detail-label">Cliente</p><strong>{historicalCustomer?historicalCustomer.name:receipt.customer||'Não informado'}</strong>
      {localizer&&<p className="order-detail-meta">Localizador: <b>{localizer}</b></p>}
      {historicalCustomer&&!phone&&<p className="order-detail-meta">{historicalCustomer.phoneLabel}</p>}
     </div>
     {phone&&(dial.replace(/\D/g,'').length>=8?
      <a className="order-detail-link" href={'tel:'+dial}><Phone size={15} aria-hidden="true"/>{phone}</a>:
      <span className="order-detail-meta">{phone}</span>)}
    </section>
    {schedule&&<section className="scheduled-order-detail"><strong className="scheduled-order-badge"><Clock3 size={16}/> AGENDADO</strong><h4>Informações do agendamento</h4><p>Modalidade: {schedule.modality}</p><p>Data e horário: <b>{schedule.when}</b></p>{schedule.release&&<p>Início do preparo: {schedule.release}</p>}{order.status==='pending'&&<p>Este pedido depende de aceite manual da loja e não entra no aceite automático.</p>}{order.status==='accepted'&&schedule.waiting&&<p>Pedido aceito · aguardando início do preparo.</p>}</section>}
    <section className="order-detail-section" aria-label="Itens do pedido">
     <h4><ShoppingBag size={17} aria-hidden="true"/> Itens do pedido</h4>
     {items.length?<ul className="order-detail-items">{items.map((item,index)=>{
      const extras=modifiers(item.modifiers||item.addons||item.complements);
      const itemNote=text(item.notes)||text(item.observation)||text(item.observacao);
      return <li key={index}>
       <span className="order-detail-quantity">{item.quantity||1}×</span>
       <div><strong>{item.name}</strong>
        {extras&&<p>Complementos: {extras}</p>}
        {itemNote&&<p className="order-detail-note">Obs.: {itemNote}</p>}
       </div>
       {item.total!=null&&<b>{money(item.total)}</b>}
      </li>;
     })}</ul>:<p className="order-detail-meta">Itens indisponíveis para este pedido.</p>}
     {note&&<p className="order-detail-note">Observação do pedido: {note}</p>}
    </section>
    {address&&(!pickup||historyMode)&&<section className="order-detail-section order-detail-address" aria-label="Endereço de entrega">
     <div><h4><MapPin size={17} aria-hidden="true"/> {pickup?'Endereço registrado':'Endereço de entrega'}</h4><p>{address}</p></div>
     {route&&<a className="order-detail-link" href={route} target="_blank" rel="noopener noreferrer"><Navigation size={15} aria-hidden="true"/> Abrir rota</a>}
    </section>}
    {(delivery||pickup||receipt.logistics==='loja'||receipt.logistics==='marketplace')&&
     <section className="order-detail-fulfillment" aria-label="Logística">
      {deliveryBadge}{courier&&<span>Entregador: <strong>{courier}</strong></span>}
     </section>}
    <section className="order-detail-section order-detail-finance" aria-label="Resumo financeiro">
     <h4><CreditCard size={17} aria-hidden="true"/> Resumo financeiro</h4>
     {method&&<p className="order-detail-meta">{paymentNames[method.toLowerCase()]||method.replace(/_/g,' ')}{paid?' · Pago':''}</p>}
      {courierReceived&&<p className="order-detail-meta">✓ Recebido pelo entregador na entrega — confirmação registrada no Pitacco</p>}
     {!method&&paid&&<p className="order-detail-meta">Pago</p>}
     {historyMode&&Number.isFinite(receivedAt)&&courierReceived&&<p className="order-detail-meta">Recebimento registrado em {new Date(receivedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p>}
     <dl>
      {receipt.subtotal!=null&&<div><dt>Subtotal</dt><dd>{money(receipt.subtotal)}</dd></div>}
      {receipt.delivery_fee!=null&&<div><dt>Taxa de entrega</dt><dd>{money(receipt.delivery_fee)}</dd></div>}
      {historicalFee!==null&&historicalFee!==amount(receipt.delivery_fee)&&<div><dt>Taxa de entrega original</dt><dd>{money(historicalFee)}</dd></div>}
      {historyMode&&receivedAmount!==null&&courierReceived&&<div><dt>Valor recebido pelo entregador</dt><dd>{money(receivedAmount)}</dd></div>}
      <div className="order-detail-total"><dt>Total</dt><dd>{money(order.gross)}</dd></div>
      {showCollection&&<div className="order-detail-collect"><dt>{historyMode?'Valor previsto para cobrança na entrega':'Cobrar na entrega'}</dt><dd>{money(due)}</dd></div>}
      {(showCollection||historicalChange)&&changeFor>0&&<><div><dt>Troco para</dt><dd>{money(changeFor)}</dd></div>
       <div><dt>Troco</dt><dd>{money(Math.max(0,changeFor-due))}</dd></div></>}
     </dl>
    </section>
    {children}
   </div>
   <footer className="order-detail-footer">{actionError&&<p role="alert">{actionError}</p>}{actions}</footer>
  </div>
 </dialog>;
}
