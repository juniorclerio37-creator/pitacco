import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/admin-ai-worker.mjs';

const endpoint='https://admin.pitacco.com.br/api/intelligence/analyze';
const originalFetch=globalThis.fetch;
function request(question='A impressão no Windows falha',changes={}){
 return new Request(endpoint,{
  method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer session-valid',origin:'https://admin.pitacco.com.br',...changes.headers},
  body:JSON.stringify({question,storeId:null,...changes.body})
 });
}
function harness({owner=true,auth=true,incidents=[],ai=true}={}){
 const called=[];
 globalThis.fetch=async (url,init)=>{
  called.push({url,init});
  if(url.endsWith('/auth/v1/user'))return Response.json(auth?{id:'user-1'}:{message:'invalid'},{status:auth?200:401});
  if(url.endsWith('/rest/v1/rpc/pitacco_is_platform_owner'))return Response.json(owner);
  if(url.endsWith('/rest/v1/rpc/pitacco_incidents'))return Response.json({rows:incidents,has_more:false});
  throw new Error('Unexpected URL '+url);
 };
 const calls=[];
 const env={
  INTELLIGENCE_RATE_LIMIT:{limit:async()=>({success:true})},
  PITACCO_SUPABASE_URL:'https://test.supabase.co',
  PITACCO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
  ASSETS:{fetch:async()=>new Response('ADMIN_ASSET')},
  ...(ai?{AI:{run:async(model,args)=>{calls.push({model,args});return {response:'Diagnóstico consultivo: confirmar os registros antes de corrigir.'};}}}:{})
 };
 return {called,calls,env};
}
test.after(()=>{globalThis.fetch=originalFetch;});

test('static admin assets do not require AI authorization',async()=>{
 const h=harness();
 const response=await worker.fetch(new Request('https://admin.pitacco.com.br/index.html'),h.env);
 assert.equal(response.status,200);assert.equal(await response.text(),'ADMIN_ASSET');
 assert.equal(h.called.length,0);
});
test('anonymous user is denied before contacting Supabase and AI',async()=>{
 const h=harness();
 const response=await worker.fetch(new Request(endpoint,{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({question:'Falha de pedidos'})}),h.env);
 assert.equal(response.status,401);assert.equal(h.called.length,0);assert.equal(h.calls.length,0);
});
test('non-owner is denied before incident retrieval and model use',async()=>{
 const h=harness({owner:false});
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,403);assert.equal(h.called.length,2);assert.equal(h.calls.length,0);
});
test('expired session is denied',async()=>{
 const h=harness({auth:false});
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,401);assert.equal(h.called.length,1);assert.equal(h.calls.length,0);
});
test('authorized diagnosis excludes identifiers and credentials from AI context',async()=>{
 const h=harness({incidents:[{
  code:'print_error',status:'open',detections:3,last_seen_at:'2026-11-17T20:00:00Z',
  store_name:'LOJA_SUPER_SECRETA',entity_id:'ORDER_SUPER_SECRET',customer_name:'CLIENTE_SUPER_SECRETO'
 }]});
 const response=await worker.fetch(request('Verifique a impressora. Bearer abcDEF01234'),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.match(payload.answer,/Diagnóstico consultivo/);
 assert.equal(payload.incidentsConsidered,1);
 assert.equal(payload.mode,'diagnostico');
 assert.equal(h.called.length,3);
 assert.equal(h.calls.length,1);
 const prompt=JSON.stringify(h.calls[0].args.messages);
 assert.match(prompt,/print_error/);
 assert.doesNotMatch(prompt,/LOJA_SUPER_SECRETA|ORDER_SUPER_SECRET|CLIENTE_SUPER_SECRETO|abcDEF01234/);
 assert.equal(response.headers.get('cache-control'),'no-store, private');
});
test('unexpected origin and invalid payloads fail closed',async()=>{
 const h=harness();
 assert.equal((await worker.fetch(request('Teste',{
  headers:{origin:'https://outro.site'}}),h.env)).status,403);
 assert.equal((await worker.fetch(request('a'.repeat(1501)),h.env)).status,400);
 assert.equal((await worker.fetch(request('Diagnóstico',{body:{storeId:'not-an-id'}}),h.env)).status,400);
 assert.equal(h.called.length,0);
});
test('rate limiting prevents inference and incident query',async()=>{
 const h=harness();h.env.INTELLIGENCE_RATE_LIMIT={limit:async()=>({success:false})};
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,429);assert.equal(h.called.length,2);assert.equal(h.calls.length,0);
});
test('missing rate limiter fails closed',async()=>{
 const h=harness();delete h.env.INTELLIGENCE_RATE_LIMIT;
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,503);assert.equal(h.called.length,2);assert.equal(h.calls.length,0);
});
test('requires a configured AI binding',async()=>{
 const h=harness({ai:false});
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,503);assert.equal(h.called.length,3);
});
