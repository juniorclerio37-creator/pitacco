import {pickupReminderType,showPickupReminder} from '../../entregador/pickup-reminder.mjs';
export {paymentSummaryPanel,courierCollectStep} from '../../entregador/payment-ui.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
// No visual changes: use the approved original modal and its existing buttons.
export function createCourierPickup({token,fetcher=globalThis.fetch,ownCollect,ifoodCollect,reminder=showPickupReminder}){
 if(typeof token!=='string'||!token||typeof ownCollect!=='function'||typeof ifoodCollect!=='function'||typeof reminder!=='function')throw Error('Sessão inválida.');
 let active=true,busy=false;
 const abort=new AbortController();
 function stop(){active=false;token='';abort.abort();}
 async function cards(){
  if(!active)throw Error('Sessão encerrada.');
  const res=await fetcher('/api/v1/courier/payments',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify({action:'unified_cards'}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});
  if(!active)throw Error('Sessão encerrada.');
  if([401,403,404].includes(res.status)){stop();throw Error('Sessão não autorizada.');}
  if(!res.ok)throw Error('Pagamento indisponível. Atualize a entrega.');
  const result=await res.json();
  if(!active||!Array.isArray(result?.data)||new Set(result.data.map(x=>x?.delivery_id)).size!==result.data.length)throw Error('Pagamento indisponível.');
  return result.data;
 }
 async function pickup(delivery){
  if(!active||busy)return false;
  if(!UUID.test(delivery?.id??'')||!['proprio','ifood'].includes(delivery.source)||delivery.logistics_provider!=='loja')throw Error('Entrega não autorizada.');
  const id=delivery.id,source=delivery.source;
  busy=true;
  try{
   const row=(await cards()).find(x=>x.delivery_id===id);
   const payment=row?.payment;
   if(!payment||!['paid','collect','unknown'].includes(payment.state)||typeof payment.method!=='string'||
     (payment.state==='collect'&&(!Number.isFinite(Number(payment.amount))||Number(payment.amount)<=0)))throw Error('Confira o pagamento com a loja.');
   const collect=async()=>{
    if(!active)throw Error('Sessão encerrada.');
    const result=await (source==='ifood'?ifoodCollect:ownCollect)(id);
    return active&&result?.collected===true;
   };
   if(pickupReminderType(payment))return (await reminder(payment,collect))===true;
   return collect();
  }finally{busy=false;}
 }
 return {pickup,cards,stop};
}
