// Read-only FCM configuration inspection, exclusively for the Pitacco platform owner.
// Do not return Firebase keys, bearer tokens, deployment environment, or account IDs.
const allowedOrigin='https://admin.pitacco.com.br';
const headersFor=(origin)=>({
 'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store, private',
 'x-content-type-options':'nosniff',
 'vary':'Origin, Authorization',
 ...(origin===allowedOrigin?{
  'access-control-allow-origin':allowedOrigin,
  'access-control-allow-headers':'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'access-control-allow-methods':'POST, OPTIONS'
 }:{})
});
const safeJson=(value,status,origin)=>Response.json(value,{status,headers:headersFor(origin)});
const validURL=value=>typeof value==='string'&&/^https:\/\/[a-z0-9.-]+(?:\:\d+)?\/?$/i.test(value);
function serviceAccountLooksConfigured(value){
 let account;
 try{account=typeof value==='string'?JSON.parse(value):value}catch{return false;}
 return !!(account&&typeof account==='object'&&
  /^[a-z0-9-]{4,100}$/.test(account.project_id||'')&&
  /^.+@.+\.iam\.gserviceaccount\.com$/.test(account.client_email||'')&&
  typeof account.private_key==='string'&&
  account.private_key.includes('-----BEGIN PRIVATE KEY-----')&&
  account.private_key.includes('-----END PRIVATE KEY-----'));
}
export function createOwnerPushReadiness({url,serviceKey,cronSecret,account,fetcher=fetch}){
 async function requestSupabase(path,token,method='GET'){
  const response=await fetcher(new URL(path,url),{
   method,redirect:'error',signal:AbortSignal.timeout(6500),
   headers:{apikey:serviceKey,authorization:'Bearer '+token,
    ...(method==='POST'?{'content-type':'application/json'}:{})},
   ...(method==='POST'?{body:'{}'}:{})
  });
  return response;
 }
 return async request=>{
  const origin=request.headers.get('origin');
  if(origin&&origin!==allowedOrigin)return safeJson({error:'Origem não autorizada'},403,origin);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headersFor(origin)});
  if(request.method!=='POST')return safeJson({error:'Método não permitido'},405,origin);
  const token=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'')?.[1];
  if(!token)return safeJson({error:'Faça login no Super Admin'},401,origin);
  if(!validURL(url)||!serviceKey)return safeJson({error:'Serviço de autenticação indisponível'},503,origin);
  try{
   const user=await requestSupabase('/auth/v1/user',token);
   if(!user.ok)return safeJson({error:'Sessão inválida'},401,origin);
   const verified=await user.json();
   if(!verified?.id)return safeJson({error:'Sessão inválida'},401,origin);
   const owner=await requestSupabase('/rest/v1/rpc/pitacco_is_platform_owner',token,'POST');
   if(!owner.ok)return safeJson({error:'Não foi possível verificar a permissão'},503,origin);
   if(await owner.json()!==true)return safeJson({error:'Acesso exclusivo do Super Admin'},403,origin);
   return safeJson({
    checked_at:new Date().toISOString(),
    fcm_service_account_configured:serviceAccountLooksConfigured(account),
    cron_secret_env_configured:typeof cronSecret==='string'&&cronSecret.trim().length>=20,
    database_service_access_configured:true,
    sender_dispatch_tested:false,
    google_oauth_tested:false,
    fcm_delivery_tested:false,
    android_audio_tested:false,
    note:'Presença e formato das credenciais, sem teste de autenticação no Google, envio de push ou confirmação de som no Android.'
   },200,origin);
  }catch{
   return safeJson({error:'Verificação temporariamente indisponível'},503,origin);
  }
 };
}
