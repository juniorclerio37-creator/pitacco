const root='https://merchant-api.ifood.com.br';
const env=(name:string)=>Deno.env.get(name)||'';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(req.method!=='POST')return reply(405,{error:'Use POST'});
 const ticket=req.headers.get('x-pitacco-central-ticket')||'';
 if(!uuid.test(ticket))return reply(401,{error:'Não autorizado'});
 const project=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),clientId=env('IFOOD_PRODUCTION_CLIENT_ID'),clientSecret=env('IFOOD_PRODUCTION_CLIENT_SECRET');
 if(!project||!service||!clientId||!clientSecret)return reply(503,{error:'Configuração indisponível'});
 const api=(url:string,init:RequestInit={})=>fetch(url,{...init,signal:AbortSignal.timeout(8000),redirect:'error'});
 const rpc=(name:string,body:unknown)=>api(project+'/rest/v1/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+service,apikey:service,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  const claim=await rpc('pitacco_ifood_central_check_claim',{p_ticket:ticket});
  if(!claim.ok)return reply(503,{error:'Fila indisponível'});
  const rows=await claim.json();
  if(!Array.isArray(rows)||!rows.length)return reply(200,{checked:0,activated:0});
  const tokenResponse=await api(root+'/authentication/v1.0/oauth/token',{method:'POST',body:new URLSearchParams({grantType:'client_credentials',clientId,clientSecret})});
  if(!tokenResponse.ok)return reply(502,{error:'Token iFood indisponível'});
  const token=(await tokenResponse.json()).accessToken;
  if(typeof token!=='string'||!token)return reply(502,{error:'Token inválido'});
  const results=await Promise.allSettled(rows.map(async(row:any)=>{
   if(!uuid.test(row.id)||!uuid.test(row.merchant_id)||!uuid.test(row.reviewed_by))return false;
   const identity=await api(root+'/merchant/v1.0/merchants/'+row.merchant_id,{headers:{authorization:'Bearer '+token}});
   if(!identity.ok)return false;
   const merchant=await identity.json();
   if(merchant.id!==row.merchant_id)return false;
   const saved=await rpc('pitacco_ifood_central_approve',{p_request:row.id,p_actor:row.reviewed_by,p_merchant:row.merchant_id,p_provider_name:typeof merchant.name==='string'?merchant.name.slice(0,200):''});
   return saved.ok&&await saved.json()===true;
  }));
  return reply(200,{checked:rows.length,activated:results.filter(r=>r.status==='fulfilled'&&r.value===true).length});
 }catch{return reply(503,{error:'Verificação temporariamente indisponível'})}
});
