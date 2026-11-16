import {createDistributedIfood} from './distributed.mjs';
const origin='https://merchant-api.ifood.com.br';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const codes=new Map([
 ['PLC','PLACED'],['CFM','CONFIRMED'],['RTP','READY_TO_PICKUP'],
 ['DSP','DISPATCHED'],['CAN','CANCELLED'],['CON','CONCLUDED'],
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
 const options=item=>(Array.isArray(item.options)?item.options:[]).flatMap(option=>{
  const name=text(option.name,140);
  return name?[{name,quantity:money(option.quantity)||1,unit_price:money(option.unitPrice)},...options(option)]:[];
 });
 return {
  external_order_id:order.id, merchant_id:order.merchant.id, created_at:iso(order.createdAt),
  display_number:text(order.displayId,32)||order.id.slice(0,8),
  customer:text(order.customer?.name)||'Cliente iFood',
  logistics:order.orderType!=='DELIVERY'?'retirada':delivery.deliveredBy==='MERCHANT'?'loja':'marketplace',
  address:[address.streetName,address.streetNumber,address.complement,address.neighborhood,address.city,address.state,address.postalCode]
   .map(x=>text(x,100)).filter(Boolean).join(', ').slice(0,500),
  notes:text(delivery.observations,1000),
  items:order.items.map(item=>({
   name:text(item.name,140),quantity:money(item.quantity),unit_price:money(item.unitPrice),
   notes:text(item.observations,500),modifiers:options(item),
  })),
  subtotal:money(order.total.subTotal),delivery_fee:money(order.total.deliveryFee),
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
 async function process(eventId=null){
  const events=await rpc('pitacco_ifood_claim',{p_event:eventId});
  for(let i=0;i<events.length;i+=4){
   const settled=await Promise.allSettled(events.slice(i,i+4).map(processOne));
   if(settled.some(result=>result.status==='rejected'))logger.warn('Uma confirmação de fila do iFood ficou para nova tentativa.');
  }
  return events.length;
 }
 return async request=>{
  const headers={'cache-control':'no-store'};
  const reply=(status,body)=>Response.json(body,{status,headers});
  const path=new URL(request.url).pathname;
  if(path.endsWith('/connect'))return distributed.connect(request);
  if(request.method!=='POST')return reply(405,{error:'Use POST'});
  if(!supabaseUrl||!serviceKey)return reply(503,{error:'Integração iFood ainda não configurada'});
  try{
   if(path.endsWith('/retry')){
    const candidate=request.headers.get('x-pitacco-queue-secret')||'';
    if(!uuid.test(candidate)||await rpc('pitacco_ifood_retry_authorized',{p_key:candidate})!==true){
     return reply(401,{error:'Não autorizado'});
    }
    await distributed.poll(enqueue);
    return reply(200,{processed:await process()});
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
   if(inserted)runInBackground(process(event.id).catch(()=>logger.warn('Fila iFood será retomada em nova tentativa.')));
   return reply(202,{});
  }catch(error){
   if(error.message==='invalid-event')return reply(400,{error:'Dados do pedido inválidos'});
   if(error.message==='body-limit')return reply(413,{error:'Evento excede o tamanho permitido'});
   logger.warn('Recepção iFood indisponível.');
   return reply(503,{error:'Serviço temporariamente indisponível'});
  }
 };
}
