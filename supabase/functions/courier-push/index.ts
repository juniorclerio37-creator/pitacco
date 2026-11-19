import { createCourierPush } from './handler.mjs';
let account = null;
try { account = JSON.parse(Deno.env.get('PITACCO_FCM_SERVICE_ACCOUNT') ?? 'null'); } catch {}
const url=Deno.env.get('SUPABASE_URL');
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// The cron bearer lives in encrypted Supabase Vault. The Edge service-role
// credential only checks its hash-matched value via a restricted Postgres RPC;
// the Vault secret itself is never bundled or returned to the client.
async function verifyVaultCron(token) {
 if(!/^[a-f0-9]{64}$/.test(token)||!url||!serviceKey)return false;
 try {
  const response=await fetch(new URL('/rest/v1/rpc/pitacco_verify_courier_push_cron',url),{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(5500),
   headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},
   body:JSON.stringify({p_token:token})
  });
  return response.ok && (await response.json())===true;
 }catch{return false;}
}
Deno.serve(createCourierPush({
 url,
 serviceKey,
 cronSecret:Deno.env.get('PITACCO_PUSH_CRON_SECRET'),
 verifyCron:verifyVaultCron,
 account
}));