import {createDistributedIfood} from './distributed.mjs';
const origin='https://merchant-api.ifood.com.br';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const codes=new Map([
 ['PLC','PLACED'],['CFM','CONFIRMED'],['RTP','READY_TO_PICKUP'],
 ['DSP','DISPATCHED'],['CAN','CANCELLED'],['CON','CONCLUDED'],
 ['CARF','CANCELLATION_REQUEST_FAILED'],
]);
const acceptedCodes=new Set(codes.values());
const text=(value,length=220)=>typeof value==='string'?value.trim().slice(0,length):'';
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:0;
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;

async function readBody(request) {
 const limit=131072;
 const reader=request.body?.getReader();
 if(!reader)return new Uint8Array();
 const chunks=[];let size=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.length;
  if(size>limit){await reader.cancel();throw Error('body-limit');}
  chunks.push(value);
 }
 const all=new Uint8Array(size);
 let offset=0;
 for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 return all;
}

function normalizeOrder(order,event) {
 if(order?.id!==event.external_order_id||order?.merchant?.id!==event.merchant_id||
   typeof order.isTest!=='boolean'||!iso(order.createdAt)||!Array.isArray(order.items)||
   typeof order.total?.orderAmount!=='number'||!Number.isFinite(order.total.orderAmount)||order.total.orderAmount<0||
   !['DELIVERY','TAKEOUT','DINE_IN'].includes(order.orderType))throw Error('invalid-order');
 const delivery=order.delivery||{};
 const address=delivery.deliveryAddress||{};
 const methods=Array.isArray(order.payments?.methods)?order.payments.methods:[];
 // API Order Details: total.deliveryFee precedes benefits targeted to DELIVERY_FEE.
 // The courier earns the original amount even if the customer sees free shipping.
 const originalDeliveryFee=money(order.total.deliveryFee);
 const deliveryDiscount=Math.min(originalDeliveryFee,
  (Array.isArray(order.benefits)?order.benefits:[])
   .filter(benefit=>benefit?.target==='DELIVERY_FEE')
   .reduce((sum,benefit)=>sum+money(benefit?.value),0));
 const options=item=>(Array.isArray(item.options)?item.options:[]).flatMap(option=>{
  const name=text(option.name,140);
  return name?[{name,quantity:money(option.quantity)||1,unit_price:money(option.unitPrice)},...options(option)]:[];
 });
 return {
  external_order_id:order.id, merchant_id:order.merchant.id, created_at:iso(order.createdAt),
  display_number:text(order.displayId,32)||order.id.slice(0,8),
  customer:text(order.customer?.name)||'Cliente iFood',
  // Telefone + localizador da API do iFood; o backend grava somente na tabela privada
  // de contatos de entregas próprias e nunca na receipt pública.
  contact_phone:text(order.customer?.phone?.number,64)||null,
  contact_localizer:text(order.customer?.phone?.localizer,32)||null,
  contact_expires_at:iso(order.customer?.phone?.localizerExpiration),

  logistics:order.orderType!=='DELIVERY'?'retirada':({MERCHANT:'loja',IFOOD:'marketplace'}[delivery.deliveredBy]??null),
  address:[address.streetName,address.streetNumber,address.complement,address.neighborhood,address.city,address.state,address.postalCode]
   .map(x=>text(x,100)).filter(Boolean).join(', ').slice(0,500),
  notes:text(delivery.observations,1000),
  items:order.items.map(item=>({
   name:text(item.name,140),quantity:money(item.quantity),unit_price:money(item.unitPrice),
   notes:text(item.observations,500),modifiers:options(item),
  })),
  subtotal:money(order.total.subTotal),delivery_fee:originalDeliveryFee,
  delivery_fee_original:originalDeliveryFee,
  delivery_fee_discount:deliveryDiscount,
  delivery_fee_customer:Math.max(0,Math.round((originalDeliveryFee-deliveryDiscount)*100)/100),
  discount:money(order.total.benefits),total:order.total.orderAmount,
  payment:methods.map(m=>text(m.method,50)).filter(Boolean).join(' / '),
  payment_status:methods.length&&methods.every(m=>m.prepaid===true)?'paid':'pending',
  provider_scheduled_for:iso(order.schedule?.deliveryDateTimeStart),
 };
}

export function createIfoodOrders({clientId,clientSecret,supabaseUrl,serviceKey,
 distributedId,distributedSecret,tokenKey,publicKey,fetcher=fetch,runInBackground=promise=>void promise,logger=console}) {
 let cachedToken,expires=0,renewing;
 let signatureKey;
 async function rpc(name,body){
  const result=await fetcher(new URL('/rest/v1/rpc/'+name,supabaseUrl),{
   method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(3500),redirect:'error',
  });
  if(!result.ok)throw Object.assign(Error('database-'+result.status),{status:result.status});
  return result.status===204?null:result.json();
 }
 const distributed=createDistributedIfood({id:distributedId,secret:distributedSecret,tokenKey,supabaseUrl,publicKey,rpc,fetcher,logger});
 async function enqueue(event,viaPolling=false){
  const code=event.fullCode??codes.get(event.code);
  if(!acceptedCodes.has(code)||(event.category&&event.category!=='FOOD'))return false;
  const at=iso(event.createdAt);
  if(!uuid.test(event.orderId??'')||!uuid.test(event.merchantId??'')||!at){
   if(viaPolling)return false;
   throw Error('invalid-event');
  }
  return rpc('pitacco_ifood_enqueue',{p_id:event.id,p_merchant:event.merchantId,p_order:event.orderId,p_code:code,p_at:at,p_distributed:viaPolling});
 }
 async function token(){
  if(cachedToken&&Date.now()<expires)return cachedToken;
  if(!renewing)renewing=(async()=>{
   const response=await fetcher(origin+'/authentication/v1.0/oauth/token',{
    method:'POST',body:new URLSearchParams({grantType:'client_credentials',clientId,clientSecret}),
    signal:AbortSignal.timeout(6000),redirect:'error',
   });
   if(!response.ok)throw Error('oauth-'+response.status);
   const data=await response.json();
   if(typeof data.accessToken!=='string'||!data.accessToken.length||!(Number(data.expiresIn)>0))throw Error('oauth-response');
   cachedToken=data.accessToken;
   expires=Date.now()+Math.max(0,Number(data.expiresIn)-60)*1000;
   return cachedToken;
  })().finally(()=>{renewing=null;});
  return renewing;
 }
 async function processOne(event){
  try{
   const accessToken=await distributed.accessFor(event.merchant_id)??await token();
   const response=await fetcher(origin+'/order/v1.0/orders/'+event.external_order_id,{
    headers:{authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(7500),redirect:'error',
   });
   if(response.status===401&&accessToken===cachedToken)cachedToken=null;
   if(!response.ok)throw Error('order-'+response.status);
   const providerOrder=await response.json();
   const order=normalizeOrder(providerOrder,event);
   await rpc('pitacco_ifood_complete',{p_event:event.event_id,p_lease:event.lease,p_order:order,p_test:providerOrder.isTest});
  }catch(error){
   logger.warn('Falha ao processar evento iFood',event.event_id);
   await rpc('pitacco_ifood_complete',{p_event:event.event_id,p_lease:event.lease,p_order:null,p_test:null});
  }
 }
 async function submitConfirm(row){
  let retry=true;
  try{
   const access=row.uses_store_token?await distributed.accessFor(row.merchant_id):clientId&&clientSecret?await token():null;
   if(!access)return;
   const response=await fetcher(origin+'/order/v1.0/orders/'+row.external_order_id+'/confirm',{
    method:'POST',headers:{authorization:'Bearer '+access},signal:AbortSignal.timeout(5000),redirect:'error',
   });
   if(response.status===401&&access===cachedToken)cachedToken=null;
   retry=response.status===401||response.status===408||response.status===429||response.status>=500;
   if(!response.ok)logger.warn('iFood recusou uma solicitação de aceite automático.',response.status);
   // A successful submission leaves the order pending until the official event is processed.
  }catch{logger.warn('Solicitação de aceite iFood será retomada.');}
  finally{await rpc('pitacco_ifood_finish_auto_confirm',{p_order:row.external_order_id,p_lease:row.lease,p_retry:retry});}
 }
 async function autoConfirm(orderId=null){
  const requests=await rpc('pitacco_ifood_claim_auto_confirm',{p_order:orderId});
  const results=await Promise.allSettled(requests.map(submitConfirm));
  if(results.some(result=>result.status==='rejected'))logger.warn('A fila de aceite iFood será retomada.');
 }
 async function process(eventId=null){
  const events=await rpc('pitacco_ifood_claim',{p_event:eventId});
  for(let i=0;i<events.length;i+=4){
   const settled=await Promise.allSettled(events.slice(i,i+4).map(processOne));
   if(settled.some(result=>result.status==='rejected'))logger.warn('Uma confirmação de fila do iFood ficou para nova tentativa.');
  }
  return events.length;
 }

 async function courierAction(request) {
  const originHeader=request.headers.get('origin');
  const cors={'cache-control':'no-store','vary':'Origin'};
  if(originHeader!=='https://entregador.pitacco.com.br') {
   return Response.json({error:'Origem não autorizada'},{status:403,headers:cors});
  }
  cors['access-control-allow-origin']=originHeader;
  cors['access-control-allow-methods']='POST, OPTIONS';
  cors['access-control-allow-headers']='authorization, apikey, content-type';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const reply=(status,body)=>Response.json(body,{status,headers:cors});
  if(request.method!=='POST')return reply(405,{error:'Use POST'});
  if(!supabaseUrl||!serviceKey||!publicKey)return reply(503,{error:'Integração indisponível'});
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return reply(401,{error:'Faça login novamente'});
  const raw=await request.text();
  if(raw.length>4096)return reply(413,{error:'Solicitação inválida'});
  let input;
  try{input=JSON.parse(raw)}catch{return reply(400,{error:'Dados inválidos'})}
  if(!uuid.test(input?.delivery??'')||!['arrival','verify','dispatch'].includes(input?.action)){
   return reply(400,{error:'Entrega ou ação inválida'});
  }
  if(input.action==='verify' && (typeof input.code!=='string'||! /^\d{4,8}$/.test(input.code))) {
   return reply(400,{error:'Informe o código numérico do cliente'});
  }
  try{
   if(input.action==='dispatch'){
    // Only the authenticated courier who already collected a READY order
    // can claim this operation. iFood partner-delivery never passes the RPC.
    const claimed=await fetcher(new URL('/rest/v1/rpc/pitacco_driver_ifood_dispatch_claim',supabaseUrl),{
     method:'POST',headers:{apikey:publicKey,authorization,'content-type':'application/json'},
     body:JSON.stringify({p_delivery:input.delivery}),signal:AbortSignal.timeout(5500),redirect:'error'
    });
    if(!claimed.ok)return reply(claimed.status===401?401:claimed.status===403?403:409,{
     error:'Apenas o motoboy responsável pode despachar um pedido pronto de entrega própria após confirmar a coleta.'
    });
    const claim=await claimed.json();
    if(claim.status==='already_confirmed')return reply(200,{provider_state:'confirmed',already:true});
    if(claim.status==='submitted')return reply(202,{provider_state:'submitted',already:true});
    if(claim.status==='pending')return reply(202,{provider_state:'pending',already:true});
    if(claim.status==='uncertain')return reply(409,{provider_state:'uncertain',
     error:'A situação do despacho está incerta. Confira o iFood antes de tentar novamente.'});
    if(claim.status!=='claimed'||!uuid.test(claim.lease)||!uuid.test(claim.external_order_id)||
       !uuid.test(claim.merchant_id))return reply(409,{error:'Despacho não autorizado.'});
    const finish=async(state,status)=>{
     try{return await rpc('pitacco_ifood_dispatch_result',{
      p_delivery:input.delivery,p_lease:claim.lease,p_state:state,p_http_status:status
     })===true}catch{return false}
    };
    let contactedProvider=false;
    try{
     const access=await distributed.accessFor(claim.merchant_id) ??
        (clientId&&clientSecret?await token():null);
     if(!access){
      await finish('rejected',0);
      return reply(503,{provider_state:'rejected',
       error:'Integração iFood indisponível. A coleta foi registrada somente no Pitacco.'});
     }
     const url=origin+'/order/v1.0/orders/'+claim.external_order_id;
     const headers={authorization:'Bearer '+access,'content-type':'application/json'};
     if(claim.ready_on_ifood!==true){
      contactedProvider=true;
      const ready=await fetcher(url+'/readyToPickup',{
       method:'POST',headers,signal:AbortSignal.timeout(9000),redirect:'error'
      });
      if(ready.status!==202){
       const state=[400,403,404,409,412,422].includes(ready.status)?'rejected':'uncertain';
       await finish(state,ready.status);
       return reply(state==='uncertain'?503:409,{provider_state:state,
        error:'O iFood ainda não aceitou o status Pronto. Despacho não enviado.'});
      }
     }
     contactedProvider=true;
     const dispatched=await fetcher(url+'/dispatch',{
      method:'POST',headers,body:JSON.stringify({deliveredBy:'MERCHANT'}),
      signal:AbortSignal.timeout(9000),redirect:'error'
     });
     const state=dispatched.status===202?'submitted':
       [400,403,404,409,412,422].includes(dispatched.status)?'rejected':'uncertain';
     if(!await finish(state,dispatched.status))return reply(503,{provider_state:'uncertain',
      error:'O iFood respondeu, mas não foi possível registrar a resposta. Consulte a plataforma.'});
     if(state!=='submitted')return reply(state==='uncertain'?503:409,{provider_state:state,
      error:'O iFood não confirmou o despacho. A coleta continua registrada no Pitacco.'});
     return reply(202,{provider_state:'submitted',
      message:'Despacho enviado ao iFood após a coleta. Aguardando o evento oficial DISPATCHED.'});
    }catch{
     await finish(contactedProvider?'uncertain':'rejected',0);
     return reply(503,{provider_state:contactedProvider?'uncertain':'rejected',
      error:contactedProvider?
       'Resultado incerto. Verifique o iFood antes de reenviar o despacho.':
       'iFood indisponível. Coleta registrada apenas no Pitacco.'});
    }
   }
   const permission=await fetcher(new URL('/rest/v1/rpc/pitacco_driver_ifood_action',supabaseUrl),{
    method:'POST',
    headers:{apikey:publicKey,authorization,'content-type':'application/json'},
    body:JSON.stringify({p_delivery:input.delivery,p_action:input.action}),
    signal:AbortSignal.timeout(5500),redirect:'error',
   });
   if(!permission.ok)return reply(permission.status===401?401:403,
     {error:'Entrega não autorizada ou integração iFood ainda indisponível'});
   const assigned=await permission.json();
   if(assigned.already)return reply(200,{provider_state:assigned.state,already:true});
   if(!uuid.test(assigned.external_order_id)||!uuid.test(assigned.merchant_id)){
    return reply(409,{error:'Vínculo iFood inválido'});
   }
   const access=await distributed.accessFor(assigned.merchant_id) ??
      (clientId&&clientSecret?await token():null);
   if(!access)return reply(503,{error:'Conexão iFood não homologada. Chegada registrada somente no Pitacco.'});
   // MERCHANT own-delivery codes use the Order module: {valid:true}.
   // The Logistics endpoint requires a separate courier lifecycle (assign/dispatch).
   const endpoint=origin+(input.action==='arrival'
    ?'/logistics/v1.0/orders/'+assigned.external_order_id+'/arrivedAtDestination'
    :'/order/v1.0/orders/'+assigned.external_order_id+'/verifyDeliveryCode');
   const response=await fetcher(endpoint,{
    method:'POST',
    headers:{authorization:'Bearer '+access,'content-type':'application/json'},
    body:input.action==='arrival'?'{}':JSON.stringify({code:input.code}),
    signal:AbortSignal.timeout(9000),redirect:'error',
   });
   // Arrival can be asynchronous; code confirmation MUST be unequivocally verified.
   let verified=false;
   if(input.action==='verify' && response.status===200){
    const verification=await response.json().catch(()=>null);
    verified=verification?.valid===true;
   }
   const isSuccess=input.action==='arrival'?[200,202,204].includes(response.status):verified;
   const permanent=[400,403,404,409,412,422].includes(response.status);
   // The service-role result is written ONLY after authenticated ownership was checked.
   if(input.action==='arrival'||isSuccess){
    const persisted=await rpc('pitacco_ifood_driver_result',{
     p_delivery:input.delivery,p_external:assigned.external_order_id,
     p_action:input.action,p_success:isSuccess,p_permanent:permanent,
    });
    if(persisted!==true)return reply(409,{error:'A entrega mudou de estado; atualize os pedidos.'});
   }
   if(!isSuccess)return reply(response.status>=500||response.status===429?503:409,{
    error:input.action==='verify'?'O iFood não validou esse código. Confira com o cliente.':
      'Chegada registrada no Pitacco, mas ainda não confirmada pelo iFood.',
    provider_state:'not_confirmed',
   });
   return reply(200,input.action==='arrival'?
    {registered:true,provider_state:'submitted',message:'Chegada enviada ao iFood; aguardando confirmação da plataforma'}:
    {verified:true,delivered:true});
  }catch(error){
   logger.warn('Operação de entrega iFood indisponível.');
   return reply(503,{error:'O iFood não respondeu. Confira a conexão e tente novamente; o registro local permanece.'});
  }
 }

 return async request=>{
  const headers={'cache-control':'no-store'};
  const reply=(status,body)=>Response.json(body,{status,headers});
  const path=new URL(request.url).pathname;
  if(path.endsWith('/connect'))return distributed.connect(request);
  if(path.endsWith('/driver-action'))return courierAction(request);
  if(request.method!=='POST')return reply(405,{error:'Use POST'});
  if(!supabaseUrl||!serviceKey)return reply(503,{error:'Integração iFood ainda não configurada'});
  try{
   if(path.endsWith('/retry')){
    const candidate=request.headers.get('x-pitacco-queue-secret')||'';
    if(!uuid.test(candidate)||await rpc('pitacco_ifood_retry_authorized',{p_key:candidate})!==true){
     return reply(401,{error:'Não autorizado'});
    }
    await distributed.poll(enqueue);
    const processed=await process();
    await autoConfirm();
    return reply(200,{processed});
   }
   if(!clientId||!clientSecret)return reply(503,{error:'Webhook iFood ainda não configurado'});
   const signature=request.headers.get('x-ifood-signature')||'';
   if(!/^[a-f0-9]{64}$/i.test(signature))return reply(401,{error:'Assinatura inválida'});
   const bytes=await readBody(request);
   signatureKey??=crypto.subtle.importKey('raw',new TextEncoder().encode(clientSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
   const signatureBytes=Uint8Array.from(signature.match(/../g),pair=>parseInt(pair,16));
   if(!await crypto.subtle.verify('HMAC',await signatureKey,signatureBytes,bytes))return reply(401,{error:'Assinatura inválida'});
   let event;
   try{event=JSON.parse(new TextDecoder().decode(bytes));}
   catch{return reply(400,{error:'Evento inválido'});}
   if(!event||Array.isArray(event)||!uuid.test(event.id??''))return reply(400,{error:'Evento inválido'});
   if(event.fullCode==='KEEPALIVE'||event.code==='KEEPALIVE'){
    if(event.merchantIds===undefined)return reply(202,{});
    if(!Array.isArray(event.merchantIds)||event.merchantIds.length>1000||event.merchantIds.some(id=>typeof id!=='string'||!uuid.test(id)))return reply(400,{error:'Lojas inválidas'});
    const merchantIds=await rpc('pitacco_ifood_online',{p_merchants:event.merchantIds});
    return reply(202,{merchantIds});
   }
   const inserted=await enqueue(event);
   if(inserted)runInBackground(process(event.id).then(()=>event.code==='PLC'||event.fullCode==='PLACED'?autoConfirm(event.orderId):null).catch(()=>logger.warn('Fila iFood será retomada em nova tentativa.')));
   return reply(202,{});
  }catch(error){
   if(error.message==='invalid-event')return reply(400,{error:'Dados do pedido inválidos'});
   if(error.message==='body-limit')return reply(413,{error:'Evento excede o tamanho permitido'});
   logger.warn('Recepção iFood indisponível.');
   return reply(503,{error:'Serviço temporariamente indisponível'});
  }
 };
}
