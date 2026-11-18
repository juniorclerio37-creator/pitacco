import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{safeDiagnosticSignals,safeRecoveryContext,safeSenderReadiness} from '../cloudflare/admin-ai-worker.mjs';

const endpoint='https://admin.pitacco.com.br/api/intelligence/analyze';
const originalFetch=globalThis.fetch;
function request(question='A impressão no Windows falha',changes={}){
 return new Request(endpoint,{
  method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer session-valid',origin:'https://admin.pitacco.com.br',...changes.headers},
  body:JSON.stringify({question,storeId:null,...changes.body})
 });
}
function harness({owner=true,auth=true,incidents=[],ai=true,metrics={registered:5,active:2,trial:2,courtesy:1},telemetry=true,preflight=true,sender=true}={}){
 const called=[];
 globalThis.fetch=async (url,init)=>{
  called.push({url,init});
  if(url.endsWith('/auth/v1/user'))return Response.json(auth?{id:'user-1'}:{message:'invalid'},{status:auth?200:401});
  if(url.endsWith('/rest/v1/rpc/pitacco_is_platform_owner'))return Response.json(owner);
  if(url.endsWith('/rest/v1/rpc/pitacco_incidents'))return Response.json({rows:incidents,has_more:false});
  if(url.endsWith('/rest/v1/rpc/pitacco_subscription_overview'))return Response.json(metrics);
  if(url.endsWith('/rest/v1/rpc/pitacco_owner_diagnostic_snapshot'))return telemetry?
    Response.json({scope:'all_stores',observed_at:'2026-11-18T02:20:00Z',
      printing:{jobs_24h:5,error:2,submitted:2,pending:1,secret_receipt:'CREDIT_CARD_SECRET'},
      courier_notifications:{server_enabled:true,sent_24h:4,unsent_24h:1,token:'PUSH_SECRET'},
      ifood:{events_24h:7,processed_24h:6,late_over_10m:1,private_order:'ORDER_SECRET'},
      marketplace_acceptance:{'99food_rejected_24h':1},
      private_customer:'CUSTOMER_SECRET'}):Response.json({message:'unavailable'},{status:503});
  if(url.endsWith('/rest/v1/rpc/pitacco_owner_recovery_preflight'))return preflight?
    Response.json({scope:'all_stores',observed_at:'2026-11-18T03:10:00Z',
     courier_push:{server_enabled:false,cron_active:false,cron_secret_present:false,
      registered_devices:0,native_devices:0,native_protocol_ready:true,token:'SECRET_FCM_TOKEN',
      api_key:'SECRET_SERVICE_ACCOUNT'},
     windows:{registered_computers:2,recently_connected_computers:0,bound_print_computers:2,
      print_error_jobs_24h:0,waiting_over_10m_24h:0,device_id:'SECRET_WINDOWS_DEVICE',
      latest_operator_test:{outcome:'awaiting_confirmation',submitted_at:'2026-11-17T21:13:22Z',
       printer_name:'SECRET_PRINTER_NAME'}}
    }):Response.json({error:'unavailable'},{status:503});
  if(url.endsWith('/functions/v1/pitacco-owner-push-readiness'))return sender?
    Response.json({fcm_service_account_configured:false,cron_secret_env_configured:false,
      database_service_access_configured:true,sender_dispatch_tested:false,
      google_oauth_tested:false,fcm_delivery_tested:false,android_audio_tested:false,
      fcm_secret:'NEVER_EXPOSE_THIS_FIREBASE_KEY',account_email:'SECRET_GMAIL_ACCOUNT'}):
    Response.json({error:'Unavailable'},{status:503});
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
 assert.equal(h.called.length,6);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].model,'@cf/meta/llama-3.1-8b-instruct-fast');
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
 assert.equal(response.status,503);assert.equal(h.called.length,6);
});

test('reported active stores comes from protected Supabase overview, not model inference',async()=>{
 const h=harness({metrics:{registered:14,active:7,trial:4,courtesy:1}});
 const response=await worker.fetch(request('Tem quantas lojas ativas?'),h.env);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.mode,'indicadores');
 assert.equal(result.source,'supabase');
 assert.match(result.answer,/7 loja\(s\) com assinatura ativa/);
 assert.match(result.answer,/14 estabelecimentos cadastrados/);
 assert.equal(h.called.length,3);
 assert.equal(h.calls.length,0);
});
test('incomplete or nonnumeric store statistics are not invented',async()=>{
 const h=harness({metrics:{active:'3',registered:10}});
 const response=await worker.fetch(request('Quantas lojas temos?'),h.env);
 assert.equal(response.status,502);
 assert.equal(h.calls.length,0);
});
test('text is extracted from real Workers AI chat-completions response',async()=>{
 const h=harness();
 h.env.AI.run=async()=>({choices:[{message:{role:'assistant',content:'Verifique a permissão de notificações e o canal de som no Android.'},finish_reason:'stop'}]});
 const response=await worker.fetch(request('Por que não toca no app do entregador?'),h.env);
 assert.equal(response.status,200);
 const answer=(await response.json()).answer;
 assert.match(answer,/permissão de notificações/);
});

test('diagnostic telemetry is allowlisted and does not leak tokens or order data',async()=>{
 const h=harness();
 const response=await worker.fetch(request('Por que a impressão e as notificações falham?'),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.signalsAvailable,true);
 assert.equal(h.called.length,6);
 assert.equal(h.calls.length,1);
 const prompt=h.calls[0].args.messages[1].content;
 assert.match(prompt,/"jobs_24h":5/);
 assert.match(prompt,/"late_over_10m":1/);
 assert.match(prompt,/"99food_rejected_24h":1/);
 assert.doesNotMatch(prompt,/PUSH_SECRET|CREDIT_CARD_SECRET|ORDER_SECRET|CUSTOMER_SECRET/);
});
test('diagnosis degrades explicitly if snapshot RPC is temporarily unavailable',async()=>{
 const h=harness({telemetry:false});
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.signalsAvailable,false);
 assert.match(JSON.stringify(h.calls[0].args.messages),/indisponíveis/);
});
test('malformed telemetry fields remain unknown; never invent zero counts',()=>{
 const data=safeDiagnosticSignals({scope:'all_stores',observed_at:'2026-11-18T03:20:00Z',
  printing:{error:'0'},courier_notifications:{server_enabled:'yes'}});
 assert.equal(data.printing.error,null);
 assert.equal(data.courier_notifications.server_enabled,null);
 assert.equal(data.marketplace_acceptance['99food_rejected_24h'],null);
 assert.equal(safeDiagnosticSignals({scope:'evil',printing:{error:0}}),null);
});

test('recovery preflight reaches the AI only as allowlisted, coarse operational evidence',async()=>{
 const h=harness();
 const response=await worker.fetch(request('Por que o entregador não recebe o alerta?'),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.recoveryAvailable,true);
 assert.equal(h.called.length,6);
 assert.equal(h.calls.length,1);
 const text=h.calls[0].args.messages[1].content;
 assert.match(text,/"cron_active":false/);
 assert.match(text,/"cron_secret_present":false/);
 assert.match(text,/"registered_devices":0/);
 assert.match(text,/"recently_connected_computers":0/);
 assert.match(text,/"outcome":"awaiting_confirmation"/);
 assert.doesNotMatch(text,/SECRET_FCM_TOKEN|SECRET_SERVICE_ACCOUNT|SECRET_WINDOWS_DEVICE|SECRET_PRINTER_NAME/);
});
test('unavailable preflight does not infer readiness',async()=>{
 const h=harness({preflight:false});
 const response=await worker.fetch(request(),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.recoveryAvailable,false);
 assert.match(h.calls[0].args.messages[1].content,/indisponível; não conclua que o serviço está pronto/);
});
test('malformed preflight fields are unknown, not converted to success',()=>{
 const value=safeRecoveryContext({scope:'all_stores',observed_at:'2026-11-18T04:00:00Z',
  courier_push:{cron_active:'true',cron_secret_present:false,registered_devices:'999',api_key:'SECRET'},
  windows:{recently_connected_computers:-3,latest_operator_test:{outcome:'printed',
    submitted_at:'2026-11-17T21:13:22Z',receipt:'SECRET_RECEIPT'}}});
 assert.equal(value.courier_push.cron_active,null);
 assert.equal(value.courier_push.cron_secret_present,false);
 assert.equal(value.courier_push.registered_devices,null);
 assert.equal(value.windows.recently_connected_computers,null);
 assert.equal(value.windows.latest_operator_test.outcome,'printed');
 assert.match(value.observed_at,/^2026-11-18T04:00:00/);
 assert.doesNotMatch(JSON.stringify(value),/SECRET|api_key|receipt/);
 assert.equal(safeRecoveryContext({scope:'not_authorized'}),null);
});

test('owner-only sender status is sanitized before sending to Workers AI',async()=>{
 const h=harness();
 const response=await worker.fetch(request('O Firebase está configurado para alertar meus entregadores?'),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.senderCredentialsAvailable,true);
 assert.equal(h.called.length,6);
 assert.equal(h.calls.length,1);
 const prompt=h.calls[0].args.messages[1].content;
 assert.match(prompt,/"fcm_service_account_configured":false/);
 assert.match(prompt,/"cron_secret_env_configured":false/);
 assert.match(prompt,/"sender_dispatch_tested":false/);
 assert.doesNotMatch(prompt,/NEVER_EXPOSE_THIS_FIREBASE_KEY|SECRET_GMAIL_ACCOUNT|account_email|fcm_secret/);
});
test('unavailable sender readiness explicitly blocks claims of active FCM configuration',async()=>{
 const h=harness({sender:false});
 const response=await worker.fetch(request('Posso ativar o push?'),h.env);
 assert.equal(response.status,200);
 const payload=await response.json();
 assert.equal(payload.senderCredentialsAvailable,false);
 assert.match(h.calls[0].args.messages[1].content,/indisponíveis; não afirme que o serviço esteja configurado/);
});
test('sender readiness only accepts expected boolean configuration flags',()=>{
 assert.equal(safeSenderReadiness({fcm_service_account_configured:'true',cron_secret_env_configured:false}),null);
 const v=safeSenderReadiness({
  fcm_service_account_configured:true,
  cron_secret_env_configured:true,
  fcm_delivery_tested:false,
  client_email:'PERSONAL_SECRET',private_key:'TOP_SECRET'
 });
 assert.equal(v.fcm_service_account_configured,true);
 assert.equal(v.fcm_delivery_tested,false);
 assert.equal(v.google_oauth_tested,null);
 assert.doesNotMatch(JSON.stringify(v),/PERSONAL_SECRET|TOP_SECRET|client_email|private_key/);
});
