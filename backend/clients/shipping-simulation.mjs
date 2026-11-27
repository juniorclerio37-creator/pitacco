// Pure rehearsal only. No fetch, storage, provider IDs or production switch.
export function createShippingSimulation(quote,{now=Date.now}={}){
 if(quote?.environment!=='simulation'||quote.homologated!==false||quote.request_enabled!==false||
    quote.quote?.simulated!==true||'id' in quote.quote||!Number.isInteger(quote.quote.net_value_cents)||
    quote.quote.net_value_cents<0||!Number.isFinite(Date.parse(quote.quote.expires_at)))throw Error('Cotação simulada inválida.');
 const expiry=Date.parse(quote.quote.expires_at),amount=quote.quote.net_value_cents;
 let state='quoted',cancel='none',lastEvent=null,ownAvailable=true;
 const snapshot=()=>({environment:'simulation',homologated:false,commercial_enabled:false,
  state,cancel_state:cancel,own_available:ownAvailable,order_preserved:true,net_value_cents:amount});
 const require=(ok)=>{if(!ok)throw Error('Transição simulada indisponível.');};
 function request(confirmed,expectedAmount){
  require(state==='quoted'&&confirmed===true&&expectedAmount===amount&&now()<expiry);
  state='requesting';ownAvailable=false;return snapshot();
 }
 function response(outcome){
  require(state==='requesting'&&['submitted','rejected','uncertain'].includes(outcome));
  state=outcome;ownAvailable=outcome==='rejected';return snapshot();
 }
 function requestCancel(confirmed){
  require(confirmed===true&&['submitted','allocated'].includes(state)&&['none','rejected'].includes(cancel));
  cancel='requesting';return snapshot();
 }
 function cancelResponse(outcome){
  require(cancel==='requesting'&&['submitted','rejected','uncertain'].includes(outcome));
  cancel=outcome;return snapshot();
 }
 function simulatedEvent({kind,sequence}={}){
  require(Number.isSafeInteger(sequence)&&sequence>0);
  if(lastEvent!==null&&sequence<=lastEvent)return snapshot();
  if(kind==='allocated'){
   require(['requesting','submitted','uncertain','allocated'].includes(state)&&!['confirmed'].includes(cancel));
   state='allocated';
  }else if(kind==='in_transit'){
   require(state==='allocated');state='in_transit';
  }else if(kind==='cancel_confirmed'){
   require(['requesting','submitted','uncertain'].includes(cancel)&&['submitted','allocated','uncertain'].includes(state));
   cancel='confirmed';state='cancelled';ownAvailable=true;
  }else if(kind==='cancel_rejected'){
   require(['requesting','submitted','uncertain'].includes(cancel));cancel='rejected';
  }else throw Error('Evento simulado desconhecido.');
  lastEvent=sequence;return snapshot();
 }
 return {snapshot,request,response,requestCancel,cancelResponse,simulatedEvent};
}
