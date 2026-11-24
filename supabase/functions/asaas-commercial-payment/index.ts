import { issueReservedCharge } from '../asaas-subscription-webhook/issue-commercial-candidate.mjs';
const origins=new Set(['https://app.pitacco.com.br','https://admin.pitacco.com.br']);
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const payId=/^pay_[A-Za-z0-9_-]{1,100}$/;
function safeLink(value:string){
 try {const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='asaas.com'||u.hostname.endsWith('.asaas.com'))&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
Deno.serve(async(req)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'cache-control':'no-store','vary':'Origin'};
 if(origins.has(origin)){headers['access-control-allow-origin']=origin;headers['access-control-allow-methods']='POST, OPTIONS';headers['access-control-allow-headers']='authorization, apikey, content-type, x-client-info, x-supabase-api-version';}
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
 if(origin&&!origins.has(origin))return reply(403,{error:'Origem não autorizada'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método indisponível'});
 if(Deno.env.get('ASAAS_COMMERCIAL_ENABLED')!=='true'||Deno.env.get('ASAAS_ENVIRONMENT')!=='production')return reply(503,{error:'Pagamentos automáticos ainda indisponíveis'});
 const authorization=req.headers.get('authorization');
 const apiKey=Deno.env.get('ASAAS_API_KEY'), base=Deno.env.get('SUPABASE_URL'), anon=Deno.env.get('SUPABASE_ANON_KEY'), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Autenticação necessária'});
 if(!apiKey||!base||!anon||!service)return reply(503,{error:'Configuração indisponível'});
 try{
  const body=await req.json();
  if(!uuid.test(body?.invoice_id||'')||!['PIX','BOLETO'].includes(body?.billing_type)||!['view','issue'].includes(body?.action))return reply(400,{error:'Dados inválidos'});
  const rpc=async(name:string,params:object,privileged=false)=>{
   const h:Record<string,string>={'content-type':'application/json',apikey:privileged?service:anon};
   if(!privileged)h.authorization=authorization;else if(service.startsWith('eyJ'))h.authorization='Bearer '+service;
   return fetch(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:h,body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(10000)});
  };
  const context=async()=>{
   const r=await rpc('pitacco_commercial_asaas_payment_context',{p_invoice:body.invoice_id});
   if(!r.ok)return null;
   return await r.json();
  };
  let ctx=await context();
  if(!ctx||ctx.invoice_id!==body.invoice_id)return reply(403,{error:'Fatura indisponível'});
  if(!ctx.available||['confirmed','received','review_required'].includes(ctx.asaas_status))return reply(409,{error:'Fatura paga ou em conciliação'});
  if(!ctx.payment_id){
   if(body.action!=='issue')return reply(200,{outcome:'not_issued',customer_ready:ctx.customer_ready});
   if(!ctx.customer_ready)return reply(409,{error:'Cadastro financeiro do estabelecimento precisa ser validado'});
   const rr=await rpc('pitacco_reserve_commercial_asaas_issue',{p_invoice:body.invoice_id,p_environment:'production',p_billing_type:body.billing_type},true);
   if(!rr.ok)return reply(503,{error:'Emissão indisponível'});
   const reservation=await rr.json();
   if(!['reserved','recover_only'].includes(reservation?.outcome))return reply(409,{error:'Fatura indisponível para emissão'});
   const issued=await issueReservedCharge({reservation,apiKey});
   if(issued.outcome!=='link_required')return reply(409,{error:'Emissão em conciliação. Não faça outro pagamento.'});
   const linked=await rpc('pitacco_link_commercial_asaas_charge',{p_invoice:issued.invoice_id,p_environment:issued.environment,p_payment_id:issued.payment_id,p_customer_id:issued.customer_id,p_amount_cents:issued.amount_cents},true);
   if(!linked.ok||!['linked','already_linked'].includes(await linked.json()))return reply(503,{error:'Emissão em conciliação. Não faça outro pagamento.'});
   ctx=await context();
  }
  if(!ctx||!ctx.available||!payId.test(ctx.payment_id||''))return reply(409,{error:'Fatura indisponível'});
  const provider=async(path:string)=>fetch(new URL(path,'https://api.asaas.com'),{headers:{accept:'application/json',access_token:apiKey,'user-agent':'Pitacco/1.0'},redirect:'error',signal:AbortSignal.timeout(10000)});
  const p=await provider('/v3/payments/'+encodeURIComponent(ctx.payment_id));
  if(!p.ok)return reply(503,{error:'Consulta indisponível'});
  const charge=await p.json();
  if(charge.id!==ctx.payment_id||charge.customer!==ctx.customer_id||charge.externalReference!=='pitacco:commercial:'+body.invoice_id||typeof charge.value!=='number'||Math.abs(charge.value*100-ctx.amount_cents)>0.000001||charge.deleted||!['PENDING','OVERDUE'].includes(charge.status))return reply(409,{error:'Pagamento em conciliação'});
  const result:Record<string,unknown>={outcome:'payable',billing_type:charge.billingType,invoice_url:safeLink(charge.invoiceUrl),bank_slip_url:safeLink(charge.bankSlipUrl)};
  if(charge.billingType==='PIX'){
   const qr=await provider('/v3/payments/'+encodeURIComponent(ctx.payment_id)+'/pixQrCode');
   if(!qr.ok)return reply(503,{error:'QR Code indisponível'});
   const q=await qr.json();
   if(typeof q.payload!=='string'||q.payload.length>4096||typeof q.encodedImage!=='string'||q.encodedImage.length>1000000||!/^[A-Za-z0-9+/=]+$/.test(q.encodedImage))return reply(503,{error:'QR Code inválido'});
   result.pix={payload:q.payload,encodedImage:q.encodedImage,expirationDate:q.expirationDate};
  }
  return reply(200,result);
 }catch{return reply(503,{error:'Não foi possível consultar o pagamento. Não repita uma cobrança em análise.'});}
});
