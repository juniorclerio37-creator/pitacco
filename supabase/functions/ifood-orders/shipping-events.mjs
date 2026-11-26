// Shipping polling shares the existing 30-second cron and is limited by server-side test-merchant leases.
export function createShippingTestPoller({rpc,token,fetcher,enqueue,process,requiresOrderProcessing=()=>true,timeout=ms=>AbortSignal.timeout(ms),logger=console}){
 const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
 const root='https://merchant-api.ifood.com.br/events/v1.0';
 const codes=new Set(['REQUEST_DRIVER','REQUEST_DRIVER_SUCCESS','REQUEST_DRIVER_FAILED','ASSIGN_DRIVER','DELIVERY_CANCELLATION_REQUESTED','DELIVERY_CANCELLATION_REQUEST_ACCEPTED','DELIVERY_CANCELLATION_REQUEST_REJECTED','DELIVERY_CANCELLED','DELIVERY_CONCLUDED','DELIVERY_IN_TRANSIT','DELIVERY_ADDRESS_CHANGE_REQUESTED','DELIVERY_ADDRESS_CHANGE_ACCEPTED','DELIVERY_ADDRESS_CHANGE_DENIED','DELIVERY_ADDRESS_CHANGE_USER_CONFIRMED','DELIVERY_DROP_CODE_REQUESTED','CANCELLATION_REQUESTED','CANCELLATION_REQUEST_FAILED','CANCELLED']);
 const aliases={ADR:'ASSIGN_DRIVER',DAR:'DELIVERY_ADDRESS_CHANGE_REQUESTED',CAN:'CANCELLED',CARF:'CANCELLATION_REQUEST_FAILED'};
 async function receive(event,knownTest=false){
  const code=event?.fullCode??aliases[event?.code]??event?.code;
  if(!uuid.test(event?.id??'')||!uuid.test(event?.merchantId??'')||!uuid.test(event?.orderId??'')||!Number.isFinite(Date.parse(event?.createdAt))||typeof code!=='string')return false;
  if(!knownTest&&!codes.has(code)&&event.salesChannel!=='POS')return false;
  const eventArgs={p_id:event.id,p_merchant:event.merchantId,p_order:event.orderId,p_at:new Date(event.createdAt).toISOString()};
  let r;
  if(code==='DELIVERY_ADDRESS_CHANGE_REQUESTED'&&event.salesChannel==='POS'){
   const address=event.metadata?.address,fields=['streetName','streetNumber','complement','neighborhood','city','state','country','postalCode','reference'];
   const safe=Object.fromEntries(fields.filter(k=>typeof address?.[k]==='string').map(k=>[k,address[k].trim().slice(0,160)]));
   const lat=address?.coordinates?.latitude,lng=address?.coordinates?.longitude;
   if(typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)safe.coordinates={latitude:lat,longitude:lng};
   r=await rpc('pitacco_ifood_shipping_test_address_event',{...eventArgs,p_address:safe});
  }else r=await rpc('pitacco_ifood_shipping_test_event',{...eventArgs,p_code:code});
  return event.salesChannel==='POS'&&(knownTest||r?.handled===true||r?.test_merchant===true);
 }
 async function pollOne(row){
  let status=0,count=0,acked=0,ok=false;
  try{
   const headers={authorization:'Bearer '+await token(),'x-polling-merchants':row.merchant_id};
   const r=await fetcher(root+'/events:polling',{headers,signal:timeout(7000),redirect:'error'});
   status=r.status;
   if(r.status===204){ok=true;return;}
   if(!r.ok)return;
   const events=await r.json();
   if(!Array.isArray(events))throw Error('poll response');
   count=events.length;
   for(const event of events){
    if(!uuid.test(event?.id??'')||event.merchantId!==row.merchant_id||!uuid.test(event.orderId??'')||!Number.isFinite(Date.parse(event.createdAt)))throw Error('invalid polling event');
    const pos=await receive(event,true);
    if(!pos&&requiresOrderProcessing(event)){
     await enqueue(event,false);
     // A duplicate may still be pending, leased, or have failed its previous processing.
     await process(event.id);
     if(await rpc('pitacco_ifood_shipping_test_order_event_done',{p_event:event.id,p_merchant:event.merchantId,p_order:event.orderId})!==true)throw Error('order event pending');
    }
    const a=await fetcher(root+'/events/acknowledgment',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify([{id:event.id}]),signal:timeout(7000),redirect:'error'});
    if(!a.ok)throw Error('ack rejected');
    acked++;
   }
   ok=true;
  }catch{logger.warn('Shipping: polling de teste pendente de nova tentativa.');}
  finally{await rpc('pitacco_ifood_shipping_test_finish_poll',{p_merchant:row.merchant_id,p_lease:row.lease,p_http:status,p_events:count,p_acked:acked,p_ok:ok});}
 }
 async function poll(){const rows=await rpc('pitacco_ifood_shipping_test_claim_poll',{});await Promise.allSettled(rows.map(pollOne));}
 return {receive,poll};
}
