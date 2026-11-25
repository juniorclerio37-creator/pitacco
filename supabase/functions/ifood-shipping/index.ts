import {buildShippingRequest} from './requests.mjs';
const root='https://merchant-api.ifood.com.br';
const env=(k:string)=>Deno.env.get(k)||'';
const url=env('SUPABASE_URL'),svc=env('SUPABASE_SERVICE_ROLE_KEY'),pub=env('SUPABASE_ANON_KEY');
const clientId=env('IFOOD_CLIENT_ID'),clientSecret=env('IFOOD_CLIENT_SECRET');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const origins=new Set(['https://admin.pitacco.com.br','https://app.pitacco.com.br','http://tauri.localhost','https://tauri.localhost']);
let token='',expires=0;
async function rpc(name:string,body:unknown){
 const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:svc,authorization:'Bearer '+svc,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(6000),redirect:'error'});
 if(!r.ok)throw Error('context');
 return r.json();
}
async function access(){
 if(token&&Date.now()<expires)return token;
 const r=await fetch(root+'/authentication/v1.0/oauth/token',{method:'POST',body:new URLSearchParams({grantType:'client_credentials',clientId,clientSecret}),signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!r.ok)throw Error('oauth-'+r.status);
 const d=await r.json();if(typeof d.accessToken!=='string'||!Number.isFinite(Number(d.expiresIn))||Number(d.expiresIn)<=0)throw Error('oauth-response');
 token=d.accessToken;expires=Date.now()+Math.max(0,Number(d.expiresIn)-60)*1000;return token;
}
async function provider(request:any){
 const a=await access();const r=await fetch(root+request.path,{method:request.method,headers:{authorization:'Bearer '+a,'content-type':'application/json'},...(request.body?{body:JSON.stringify(request.body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(r.status===401)token='';
 const d=await r.json().catch(()=>null);
 const code=typeof d?.code==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(d.code)?d.code:null;
 return {ok:r.ok,status:r.status,code,data:d};
}
function safeQuote(d:any){
 if(!uuid.test(d?.id??'')||!Number.isFinite(Date.parse(d.expirationAt))||Date.parse(d.expirationAt)<=Date.now()||typeof d.quote?.netValue!=='number'||!Number.isFinite(d.quote.netValue)||d.quote.netValue<0)throw Error('quote-response');
 const number=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 return {id:d.id,expirationAt:d.expirationAt,createdAt:d.createdAt??null,distance:number(d.distance),preparationTime:number(d.preparationTime),grossValue:number(d.quote.grossValue),discount:number(d.quote.discount),raise:number(d.quote.raise),netValue:d.quote.netValue,deliveryTime:{min:number(d.deliveryTime?.min),max:number(d.deliveryTime?.max)}};
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',auth=req.headers.get('authorization')||'';
 const headers:Record<string,string>={'cache-control':'no-store','vary':'Origin'};
 if(origins.has(origin)){headers['access-control-allow-origin']=origin;headers['access-control-allow-methods']='POST, OPTIONS';headers['access-control-allow-headers']='authorization, apikey, content-type, x-client-info, x-supabase-api-version'}
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
 if(origin&&!origins.has(origin))return reply(403,{error:'Origem não autorizada.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Use POST.'});
 if(!svc||!pub||!clientId||!clientSecret)return reply(503,{error:'Aplicativo de testes não configurado.'});
 if(!/^Bearer \S+$/.test(auth))return reply(401,{error:'Faça login no Pitacco.'});
 try{
  const raw=await req.text();if(raw.length>4096)return reply(413,{error:'Solicitação inválida.'});
  const d=JSON.parse(raw);if(!uuid.test(d.store_id??'')||!['status','inside_quote','outside_quote','details','booking_status','request_driver'].includes(d.action))return reply(400,{error:'Ação inválida.'});
  let actor:string|null=null;
  if(auth!=='Bearer '+svc){const r=await fetch(url+'/auth/v1/user',{headers:{apikey:pub,authorization:auth},signal:AbortSignal.timeout(6000),redirect:'error'});if(!r.ok)return reply(401,{error:'Sessão inválida.'});actor=(await r.json()).id;if(!uuid.test(actor??''))return reply(401,{error:'Conta inválida.'});}
  if(['inside_quote','details','booking_status','request_driver'].includes(d.action)&&!uuid.test(d.order_id??''))return reply(400,{error:'Selecione um pedido de teste.'});
  let ctx:any;try{ctx=await rpc('pitacco_ifood_shipping_test_context',{p_store:d.store_id,p_actor:actor,p_order:['inside_quote','details','booking_status','request_driver'].includes(d.action)?d.order_id:null})}catch{return reply(403,{error:'Apenas loja de homologação autorizada.'})}
  if(d.action==='status')return reply(200,{environment:'test',client_id:clientId,merchant_id:ctx.merchant_id,orders:ctx.orders,has_location:ctx.store_latitude!=null&&ctx.store_longitude!=null,mutations_enabled:true,external_create_enabled:false});
  if(d.action==='outside_quote'){
   const latitude=d.latitude??ctx.store_latitude,longitude=d.longitude??ctx.store_longitude;
   let call;try{call=buildShippingRequest('outside_quote',{merchantId:ctx.merchant_id,latitude,longitude})}catch{return reply(400,{error:'Coordenadas inválidas.'})}
   const q=await provider(call);if(!q.ok)return reply(200,{available:false,provider_http:q.status,provider_code:q.code});
   return reply(200,{available:true,environment:'test',quote:safeQuote(q.data)});
  }
  const book=(action:string,data:unknown={})=>rpc('pitacco_ifood_shipping_test_booking',{p_action:action,p_store:d.store_id,p_actor:actor,p_order:d.order_id,p_data:data});
  const safeBooking=(b:any)=>({state:b.state,quote_id:b.quote_id,quote_amount:b.quote_amount,quote_expires_at:b.quote_expires_at,provider_http:b.provider_http});
  if(d.action==='booking_status')return reply(200,safeBooking(await book('status')));
  const details=await provider(buildShippingRequest('details',{orderId:ctx.external_id}));
  if(!details.ok)return reply(200,{available:false,provider_http:details.status,provider_code:details.code});
  if(details.data?.id!==ctx.external_id||details.data?.merchant?.id!==ctx.merchant_id||details.data?.isTest!==true)return reply(409,{error:'O iFood não confirmou pedido de teste desta loja.'});
  const code=details.data?.delivery?.pickupCode;
  const pickupCode=typeof code==='string'&&/^[0-9A-Za-z-]{1,32}$/.test(code)?code:null;
  if(d.action==='details')return reply(200,{order_id:ctx.external_id,pickupCode,deliveredBy:details.data?.delivery?.deliveredBy??null,environment:'test'});
  if(!ctx.eligible||details.data?.orderType!=='DELIVERY'||details.data?.delivery?.deliveredBy!=='MERCHANT')return reply(409,{error:'Pedido não elegível para troca de logística.'});
  if(d.action==='request_driver'){
   if(d.confirmed!==true||!uuid.test(d.quote_id??'')||typeof d.netValue!=='number'||!Number.isFinite(d.netValue)||d.netValue<0)return reply(400,{error:'Confirme a cotação e seu valor antes de solicitar.'});
   let claim:any;try{claim=await book('claim',{id:d.quote_id,netValue:d.netValue})}catch{return reply(409,{error:'Cotação expirada, alterada ou entrega já reservada. Atualize os dados.'})}
   let http=0,code=null;
   try{
    let call;try{call=buildShippingRequest('request_driver',{orderId:ctx.external_id,quote:claim,now:Date.now()})}catch{http=400;throw Error('expired quote')}
    const result=await provider(call);http=result.status;code=result.code;
   }catch{/* ambiguous request remains reserved; never repeat automatically */}
   let result:any;try{result=await book('finish',{attempt:claim.attempt,http})}catch{return reply(503,{error:'A entrega permanece reservada; consulte a situação antes de tentar novamente.'})}
   return reply(200,{...safeBooking(result),provider_code:code,environment:'test'});
  }
  const q=await provider(buildShippingRequest('inside_quote',{orderId:ctx.external_id}));
  if(!q.ok)return reply(200,{available:false,provider_http:q.status,provider_code:q.code,pickupCode});
  const quote=safeQuote(q.data);await book('quote',quote);
  return reply(200,{available:true,environment:'test',quote,pickupCode});
 }catch(e){const m=e instanceof Error?e.message:'';return reply(503,{error:'Consulta Shipping indisponível.',...(/^oauth-\d{3}$/.test(m)?{provider_http:Number(m.slice(6))}:{})})}
});
