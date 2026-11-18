import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerPushReadiness} from '../supabase/functions/pitacco-owner-push-readiness/handler.mjs';

const origin='https://admin.pitacco.com.br';
function mock({owner=true,auth=true,account,cronSecret}={}){
 const calls=[];
 const fetcher=async(target,options)=>{
  const url=String(target);
  calls.push({url,options});
  if(url.endsWith('/auth/v1/user'))
   return Response.json(auth?{id:'approved-user'}:{message:'invalid'},
    {status:auth?200:401});
  if(url.endsWith('/rest/v1/rpc/pitacco_is_platform_owner'))return Response.json(owner);
  throw new Error('Unexpected remote request '+url);
 };
 const handler=createOwnerPushReadiness({
  url:'https://example.supabase.co',
  serviceKey:'SERVER_ONLY_SECRET',
  cronSecret,
  account,
  fetcher
 });
 const request=(token='valid-user-jwt',options={})=>new Request(
  'https://example.supabase.co/functions/v1/pitacco-owner-push-readiness',{
   method:'POST',
   headers:{authorization:token?'Bearer '+token:'',origin,...options.headers},
   body:'{}',
   ...options
  });
 return {calls,handler,request};
}
const account={
 client_email:'pitacco@example.iam.gserviceaccount.com',
 project_id:'pitacco-firebase',
 private_key:'-----BEGIN PRIVATE KEY-----\nSUPER_SECRET_MATERIAL\n-----END PRIVATE KEY-----'
};

test('rejects anonymous before querying Supabase',async()=>{
 const h=mock({owner:true});
 const res=await h.handler(h.request(''));
 assert.equal(res.status,401);
 assert.equal(h.calls.length,0);
});
test('denies authenticated shop managers before returning environment status',async()=>{
 const h=mock({owner:false,account,cronSecret:'SECRET_12345678901234567890'});
 const res=await h.handler(h.request());
 assert.equal(res.status,403);
 assert.equal(h.calls.length,2);
});
test('denies invalid or expired sessions',async()=>{
 const h=mock({auth:false});
 const res=await h.handler(h.request());
 assert.equal(res.status,401);
 assert.equal(h.calls.length,1);
});
test('responds with boolean presence indicators and never credentials',async()=>{
 const h=mock({owner:true,account,cronSecret:'SECRET_12345678901234567890'});
 const res=await h.handler(h.request());
 assert.equal(res.status,200);
 const payload=await res.json();
 assert.equal(payload.fcm_service_account_configured,true);
 assert.equal(payload.cron_secret_env_configured,true);
 assert.equal(payload.google_oauth_tested,false);
 assert.equal(payload.fcm_delivery_tested,false);
 assert.equal(payload.android_audio_tested,false);
 assert.equal(payload.sender_dispatch_tested,false);
 assert.equal(res.headers.get('cache-control'),'no-store, private');
 const output=JSON.stringify(payload);
 assert.doesNotMatch(output,/SUPER_SECRET_MATERIAL|SERVER_ONLY_SECRET|SECRET_12345678901234567890/);
 assert.equal(h.calls.length,2);
 assert.ok(h.calls.every(c=>c.url.startsWith('https://example.supabase.co/')));
});
test('reports absent or malformed sender credentials as pending',async()=>{
 const h=mock({account:'{"project_id":"broken"}',cronSecret:'short'});
 const res=await h.handler(h.request());
 assert.equal(res.status,200);
 const payload=await res.json();
 assert.equal(payload.fcm_service_account_configured,false);
 assert.equal(payload.cron_secret_env_configured,false);
});
test('rejects foreign origins and does not query Supabase',async()=>{
 const h=mock({account});
 const req=h.request('valid-user-jwt',{headers:{origin:'https://malicious.example'}});
 const res=await h.handler(req);
 assert.equal(res.status,403);
 assert.equal(h.calls.length,0);
});
test('CORS preflight only authorizes official admin origin',async()=>{
 const h=mock();
 const req=new Request('https://example.supabase.co/functions/v1/pitacco-owner-push-readiness',{
  method:'OPTIONS',headers:{origin}
 });
 const res=await h.handler(req);
 assert.equal(res.status,204);
 assert.equal(res.headers.get('access-control-allow-origin'),origin);
 assert.equal(h.calls.length,0);
});
test('failed Supabase authentication backend never exposes configuration',async()=>{
 const h=mock();
 const res=await createOwnerPushReadiness({url:'',serviceKey:'SECRET'})(h.request());
 assert.equal(res.status,503);
 assert.equal((await res.json()).fcm_service_account_configured,undefined);
});
