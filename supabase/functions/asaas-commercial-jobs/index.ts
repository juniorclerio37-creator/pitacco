import {issueReservedCharge} from '../asaas-subscription-webhook/issue-commercial-candidate.mjs';
import {reconcileCommercialPayment} from '../asaas-subscription-webhook/commercial-candidate.mjs';
const encoder=new TextEncoder();
async function equalToken(a:string,b:string){
 const [x,y]=await Promise.all([a,b].map(v=>crypto.subtle.digest('SHA-256',encoder.encode(v))));
 const l=new Uint8Array(x),r=new Uint8Array(y);let diff=0;for(let i=0;i<l.length;i++)diff|=l[i]^r[i];return diff===0;
}
Deno.serve(async req=>{
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),apiKey=Deno.env.get('ASAAS_API_KEY'),base=Deno.env.get('SUPABASE_URL');
 if(req.method!=='POST')return reply(405,{outcome:'unavailable'});
 const token=req.headers.get('authorization')||'';
 if(!service||token.length>8192||!await equalToken(token,'Bearer '+service))return reply(401,{outcome:'unauthorized'});
 if(Deno.env.get('ASAAS_COMMERCIAL_ENABLED')!=='true'||Deno.env.get('ASAAS_ENVIRONMENT')!=='production'||!apiKey||!base)return reply(503,{outcome:'disabled'});
 const rpc=async(name:string,params:object={})=>{
  const headers:Record<string,string>={'content-type':'application/json',apikey:service};
  if(service.startsWith('eyJ'))headers.authorization='Bearer '+service;
  const r=await fetch(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers,body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('rpc_failed');return await r.json();
 };
 const counts={issued:0,reconciled:0,review:0};
 try{
  // Reconciliation stays independent of the opt-in for new charges.
  const checks=await rpc('pitacco_commercial_asaas_reconciliation_jobs');
  for(const j of checks.slice(0,10)){
   try{
    if(!/^pay_[A-Za-z0-9_-]{1,100}$/.test(j.payment_id))throw Error('invalid_id');
    const r=await fetch(new URL('/v3/payments/'+encodeURIComponent(j.payment_id),'https://api.asaas.com'),{headers:{accept:'application/json',access_token:apiKey,'user-agent':'Pitacco/1.0'},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('provider_unavailable');
    const payment=await r.json();if(payment.id!==j.payment_id)throw Error('invalid_id');if(payment.deleted)payment.status='DELETED';
    const result=await reconcileCommercialPayment({payment,environment:'production',supabaseUrl:base,serviceKey:service});
    if(!result||['review_required','unlinked'].includes(result))counts.review++;else counts.reconciled++;
   }catch{counts.review++}
  }
  const jobs=await rpc('pitacco_commercial_asaas_pending_jobs');
  for(const j of jobs.slice(0,10)){
   try{
    const reservation=await rpc('pitacco_reserve_commercial_asaas_issue',{p_invoice:j.invoice_id,p_environment:'production',p_billing_type:j.billing_type});
    if(!['reserved','recover_only'].includes(reservation?.outcome))continue;
    const result=await issueReservedCharge({reservation,apiKey});
    if(result.outcome!=='link_required'){counts.review++;continue}
    const linked=await rpc('pitacco_link_commercial_asaas_charge',{p_invoice:result.invoice_id,p_environment:result.environment,p_payment_id:result.payment_id,p_customer_id:result.customer_id,p_amount_cents:result.amount_cents});
    if(['linked','already_linked'].includes(linked))counts.issued++;else counts.review++;
   }catch{counts.review++}
  }
  return reply(200,{outcome:'completed',...counts});
 }catch{return reply(503,{outcome:'unavailable',...counts});}
});
