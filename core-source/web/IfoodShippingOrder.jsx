import React,{useEffect,useRef,useState} from 'react';
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const reserved=new Set(['requesting','submitted','uncertain','allocated']);
const states={requesting:'Solicitando entregador parceiro…',submitted:'Solicitação enviada. Aguardando confirmação oficial do iFood.',uncertain:'Resultado indefinido. Não solicite outro entregador até verificar a situação.',allocated:'Entrega parceira confirmada pelo iFood.',failed:'Solicitação não confirmada. A entrega própria permanece disponível.',completed:'Entrega concluída pelo iFood.',cancelled:'Pedido cancelado pelo iFood.'};
export const shippingReserved=delivery=>['SHIPPING_REQUESTING','SHIPPING_SUBMITTED','SHIPPING_UNCERTAIN'].includes(delivery?.external_delivery_status);
export default function IfoodShippingOrder({client,store,order,onUpdate,autoQuote=false,disabled=false,onBusy}){
 const [booking,setBooking]=useState(null),[quote,setQuote]=useState(null),[pickup,setPickup]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=useRef(false),autoStarted=useRef(false);
 async function call(action,extra={}){const r=await client.functions.invoke('ifood-shipping',{body:{action,store_id:store,order_id:order,...extra}});if(r.error){const d=await r.error.context?.clone?.().json().catch(()=>null);throw Error(d?.error||'Serviço iFood indisponível.')}return r.data;}
 useEffect(()=>{let live=true;const refresh=async()=>{if(running.current)return;try{const b=await call('booking_status');if(live)setBooking(b)}catch{}};refresh();const timer=setInterval(refresh,5000);return()=>{live=false;clearInterval(timer)}},[client,store,order]);
 async function run(action,extra={}){if(running.current||disabled)return;running.current=true;setBusy(true);onBusy?.(true);setError('');try{const r=await call(action,extra);if('pickupCode'in r)setPickup(r.pickupCode);if(action==='inside_quote'){setQuote(r.quote||null);if(!r.available)throw Error('iFood não disponibilizou entregador: '+(r.provider_code||'HTTP '+r.provider_http));setBooking({state:'quoted'});}else if(action==='request_driver'||action==='cancel_driver'){setQuote(null);setBooking(r);onUpdate?.();}else if(r.available===false)throw Error('Consulta indisponível: '+(r.provider_code||'HTTP '+r.provider_http));}catch(e){setError(e.message)}finally{running.current=false;setBusy(false);onBusy?.(false)}}
 const cancelPending=['requesting','submitted','uncertain'].includes(booking?.cancel_state);
 const locked=reserved.has(booking?.state)||cancelPending;
 const canCancel=['submitted','allocated'].includes(booking?.state)&&!cancelPending&&booking?.cancel_state!=='confirmed';
 useEffect(()=>{if(autoQuote&&!disabled&&booking&&!locked&&!autoStarted.current&&['none','quoted','failed'].includes(booking.state)){autoStarted.current=true;void run('inside_quote')}},[autoQuote,disabled,booking?.state,locked]);
 return <div className="delivery-choice dispatch-partner" aria-label="Entregador parceiro iFood"><h3>iFood Sob Demanda</h3><p>Homologação · compare a cotação antes de contratar. Não é atribuído motoboy próprio durante uma solicitação pendente.</p>
 {booking?.state&&states[booking.state]&&booking.cancel_state!=='confirmed'&&<p role="status">{states[booking.state]}</p>}
 {cancelPending&&<p role="status">Cancelamento logístico em confirmação. Não atribua outro entregador.</p>}
 {booking?.cancel_state==='rejected'&&<p role="status">Cancelamento do entregador recusado. A solicitação original permanece sujeita ao iFood. O pedido não foi cancelado.</p>}
 {booking?.cancel_state==='confirmed'&&<p role="status">Sob Demanda cancelado. O pedido continua ativo. Selecione outro entregador.</p>}
 {canCancel&&<button type="button" className="secondary" disabled={busy||disabled} onClick={()=>{if(window.confirm('Cancelar apenas o Sob Demanda? O pedido, pagamento e prazo permanecem ativos.'))run('cancel_driver',{confirmed:true})}}>Cancelar Sob Demanda</button>}
 {pickup!==null&&<p>Código de coleta (pickupCode): <strong>{pickup||'Ainda não informado'}</strong></p>}
 {error&&<p role="alert" className="notice error">{error}</p>}
 <button type="button" className="secondary" disabled={busy||disabled||locked} onClick={()=>run('inside_quote')}>{busy?'Consultando…':quote?'Atualizar cotação':'Consultar valor da entrega iFood'}</button>{' '}
 <button type="button" className="secondary" disabled={busy||disabled} onClick={()=>run('details')}>Consultar código de coleta</button>
 {quote&&!locked&&<div><p>Valor da entrega: <strong>{money.format(quote.netValue)}</strong></p><p>Previsão: {Number.isFinite(quote.deliveryTime?.min)?Math.ceil(quote.deliveryTime.min/60):'—'} a {Number.isFinite(quote.deliveryTime?.max)?Math.ceil(quote.deliveryTime.max/60):'—'} min</p><p>Cotação válida até {new Date(quote.expirationAt).toLocaleString('pt-BR')}</p><button type="button" disabled={busy||disabled||Date.parse(quote.expirationAt)<=Date.now()} onClick={()=>{if(window.confirm('Solicitar entregador iFood por '+money.format(quote.netValue)+'?'))run('request_driver',{quote_id:quote.id,netValue:quote.netValue,confirmed:true})}}>Contratar por {money.format(quote.netValue)}</button></div>}
 </div>;
}
