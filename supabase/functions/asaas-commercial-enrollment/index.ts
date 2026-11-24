import {enrollCustomer,validDocument} from '../asaas-commercial-payment/enroll-customer.mjs';
const origins=new Set(['https://admin.pitacco.com.br']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'cache-control':'no-store','vary':'Origin'};
 if(origins.has(origin)){headers['access-control-allow-origin']=origin;headers['access-control-allow-methods']='POST, OPTIONS';headers['access-control-allow-headers']='authorization, apikey, content-type, x-client-info, x-supabase-api-version';}
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
 if(origin&&!origins.has(origin))return reply(403,{error:'Origem não autorizada'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método indisponível'});
 if(Deno.env.get('ASAAS_COMMERCIAL_ENABLED')!=='true'||Deno.env.get('ASAAS_ENVIRONMENT')!=='production')return reply(503,{error:'Integração indisponível'});
 const authorization=req.headers.get('authorization');
 const apiKey=Deno.env.get('ASAAS_API_KEY'),base=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Autenticação necessária'});
 if(!apiKey||!base||!anon||!service)return reply(503,{error:'Configuração indisponível'});
 try{
  const b=await req.json();
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b?.store_id||'')||typeof b?.name!=='string'||b.name.trim().length<3||b.name.length>150||!validDocument(b.document)||b.confirmed!==true)return reply(400,{error:'Informe os dados fiscais validados'});
  const rpc=(name:string,params:object,privileged=false)=>{
   const h:Record<string,string>={'content-type':'application/json',apikey:privileged?service:anon};
   if(!privileged)h.authorization=authorization;else if(service.startsWith('eyJ'))h.authorization='Bearer '+service;
   return fetch(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:h,body:JSON.stringify(params),redirect:'error',signal:AbortSignal.timeout(10000)});
  };
  const access=await rpc('pitacco_owner_asaas_enrollment_access',{p_store:b.store_id});
  if(!access.ok)return reply(403,{error:'Cadastro reservado ao Super Admin'});
  const info=await access.json();
  if(info?.allowed!==true)return reply(403,{error:'Sem permissão'});
  if(info.linked)return reply(200,{outcome:'already_linked'});
  const rr=await rpc('pitacco_reserve_asaas_customer',{p_store:b.store_id},true);
  if(!rr.ok)return reply(503,{error:'Cadastro indisponível'});
  const reservation=await rr.json();
  if(reservation==='already_linked')return reply(200,{outcome:'already_linked'});
  if(!['reserved','recover_only'].includes(reservation))return reply(409,{error:'Cadastro em análise'});
  const result=await enrollCustomer({storeId:b.store_id,name:b.name,document:b.document,reservation,apiKey});
  if(result.outcome!=='link_required')return reply(409,{error:'Cadastro em conciliação. Não crie outro cliente.'});
  const link=await rpc('pitacco_finalize_asaas_customer',{p_store:b.store_id,p_customer_id:result.customer_id},true);
  if(!link.ok||!['linked','already_linked'].includes(await link.json()))return reply(409,{error:'Cadastro em conciliação'});
  return reply(200,{outcome:'linked'});
 }catch{return reply(503,{error:'Não foi possível validar o cadastro. Não repita cadastros em análise.'});}
});
