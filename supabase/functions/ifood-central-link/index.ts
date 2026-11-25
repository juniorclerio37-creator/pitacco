const root='https://merchant-api.ifood.com.br';
const env=(name:string)=>Deno.env.get(name)||'';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');
 const headers={'cache-control':'no-store','content-type':'application/json','vary':'Origin','access-control-allow-origin':'https://admin.pitacco.com.br','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version'};
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
 if(origin!=='https://admin.pitacco.com.br')return reply(403,{error:'Origem não autorizada.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Use POST.'});
 const authorization=req.headers.get('authorization')||'';
 if(!/^Bearer \S+$/.test(authorization))return reply(401,{error:'Faça login no Super Admin.'});
 const project=env('SUPABASE_URL'),publicKey=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY'),clientId=env('IFOOD_PRODUCTION_CLIENT_ID'),clientSecret=env('IFOOD_PRODUCTION_CLIENT_SECRET');
 if(!project||!publicKey||!service||!clientId||!clientSecret)return reply(503,{error:'Credenciais centralizadas de produção não configuradas.'});
 const api=(url:string,init:RequestInit={})=>fetch(url,{...init,signal:AbortSignal.timeout(8000),redirect:'error'});
 const authHeaders={authorization,apikey:publicKey,'content-type':'application/json'};
 const rpc=(name:string,body:unknown,privileged=false)=>api(project+'/rest/v1/rpc/'+name,{method:'POST',headers:privileged?{authorization:'Bearer '+service,apikey:service,'content-type':'application/json'}:authHeaders,body:JSON.stringify(body)});
 try{
  const raw=await req.text();if(raw.length>2048)return reply(413,{error:'Solicitação inválida.'});
  const d=JSON.parse(raw);if(!uuid.test(d?.request_id??''))return reply(400,{error:'Solicitação inválida.'});
  const user=await api(project+'/auth/v1/user',{headers:authHeaders});
  if(!user.ok)return reply(401,{error:'Sessão inválida.'});
  const actor=(await user.json()).id;
  const owner=await rpc('pitacco_is_platform_owner',{});
  if(!owner.ok||await owner.json()!==true)return reply(403,{error:'Somente o proprietário pode ativar.'});
  const list=await rpc('pitacco_owner_ifood_central_requests',{});
  if(!list.ok)return reply(503,{error:'Não foi possível consultar a solicitação.'});
  const row=(await list.json()).find((r:any)=>r.id===d.request_id&&r.state==='awaiting');
  if(!row||!uuid.test(row.merchant_id))return reply(409,{error:'Solicitação indisponível.'});
  // iFood requires a fresh token after a merchant grants permission.
  const tokenResponse=await api(root+'/authentication/v1.0/oauth/token',{method:'POST',body:new URLSearchParams({grantType:'client_credentials',clientId,clientSecret})});
  if(!tokenResponse.ok)return reply(502,{error:'O iFood não autorizou o token de produção.'});
  const token=(await tokenResponse.json()).accessToken;
  if(typeof token!=='string'||!token)return reply(502,{error:'Token de produção inválido.'});
  const identity=await api(root+'/merchant/v1.0/merchants/'+row.merchant_id,{headers:{authorization:'Bearer '+token}});
  if([401,403,404].includes(identity.status))return reply(409,{error:'Permissão ainda não confirmada pelo iFood. Confira o módulo Merchant e aguarde até 10 minutos após a autorização.'});
  if(!identity.ok)return reply(502,{error:'Consulta ao iFood indisponível.'});
  const merchant=await identity.json();
  if(merchant.id!==row.merchant_id)return reply(409,{error:'Identidade do estabelecimento não confirmada.'});
  const providerName=typeof merchant.name==='string'?merchant.name.slice(0,200):'';
  const saved=await rpc('pitacco_ifood_central_approve',{p_request:row.id,p_actor:actor,p_merchant:row.merchant_id,p_provider_name:providerName},true);
  if(!saved.ok||await saved.json()!==true)return reply(409,{error:'Vínculo não gravado. Confira o estabelecimento e as solicitações.'});
  return reply(200,{linked:true,provider_name:providerName});
 }catch{return reply(503,{error:'Não foi possível verificar o vínculo. Tente novamente.'})}
});
