import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createIfoodOrders} from '../supabase/functions/ifood-orders/handler.mjs';

const id={event:'00000000-0000-0000-0000-000000000001',merchant:'00000000-0000-0000-0000-000000000002',
 order:'00000000-0000-0000-0000-000000000003',store:'00000000-0000-0000-0000-000000000004',
 attempt:'00000000-0000-0000-0000-000000000005',actor:'00000000-0000-0000-0000-000000000006'};
const event={id:id.event,code:'PLC',orderId:id.order,merchantId:id.merchant,category:'FOOD',createdAt:'2026-11-16T14:00:00Z'};
const order={id:id.order,merchant:{id:id.merchant},isTest:false,createdAt:event.createdAt,displayId:'701',
 orderType:'DELIVERY',delivery:{deliveredBy:'IFOOD'},customer:{name:'Cliente Teste',documentNumber:'ocultar'},
 total:{orderAmount:25},items:[{name:'Açaí',quantity:1,unitPrice:25}],payments:{methods:[{method:'PIX',prepaid:true}]}};
const noopLogger={warn:()=>{}};
const config={supabaseUrl:'https://db.example.test',serviceKey:'db-fixture',logger:noopLogger};
const endpoint='https://db.example.test/functions/v1/ifood-orders';
const json=(body,status=200)=>Response.json(body,{status});

test('signed webhook durably stores order before acknowledging and verifies official details',async()=>{
 const body=JSON.stringify(event),key='fixture-central';
 const calls=[];
 let background;
 const handler=createIfoodOrders({...config,clientId:'central-id',clientSecret:key,
  runInBackground:promise=>{background=promise;},
  fetcher:async(url,opts)=>{
   const p=new URL(url).pathname;
   calls.push(p);
   if(p.endsWith('/pitacco_ifood_enqueue'))return json(true);
   if(p.endsWith('/pitacco_ifood_claim_auto_confirm'))return json([]);
   if(p.endsWith('/pitacco_ifood_claim'))return json([{event_id:id.event,merchant_id:id.merchant,external_order_id:id.order,lease:id.attempt}]);
   if(p.endsWith('/pitacco_ifood_poll_credential'))return json(null);
   if(p.endsWith('/oauth/token')){
    assert.equal(opts.body.get('grantType'),'client_credentials');
    return json({accessToken:'central-access',expiresIn:3600});
   }
   if(p.endsWith('/orders/'+id.order)){
    assert.equal(opts.headers.authorization,'Bearer central-access');
    return json(order);
   }
   if(p.endsWith('/pitacco_ifood_complete')){
    const payload=JSON.parse(opts.body);
    assert.equal(payload.p_order.logistics,'marketplace');
    assert.equal(payload.p_order.display_number,'701');
    assert.equal(payload.p_order.payment_status,'paid');
    assert.equal(JSON.stringify(payload).includes('ocultar'),false);
    return json(null);
   }
   throw Error('unexpected '+p);
  },
 });
 const sign=value=>createHmac('sha256',key).update(value).digest('hex');
 const submit=(body,signature)=>handler(new Request(endpoint,{method:'POST',body,headers:{'x-ifood-signature':signature}}));
 assert.equal((await submit(body+' ',sign(body))).status,401);
 assert.deepEqual(calls,[]);
 assert.equal((await submit(body,sign(body))).status,202);
 await background;
 assert.ok(calls[0].endsWith('/pitacco_ifood_enqueue'));
 assert.ok(calls.at(-2).endsWith('/pitacco_ifood_complete'));
 assert.ok(calls.at(-1).endsWith('/pitacco_ifood_claim_auto_confirm'));
});

test('merchant link checks the authorization belongs to the requested iFood account',async()=>{
 let verifier,binding,credentialAllowed=false,approved=true;
 const providerCalls=[];
 const handler=createIfoodOrders({...config,distributedId:'dist-id',distributedSecret:'dist-secret',publicKey:'publishable',
  tokenKey:Buffer.alloc(32,4).toString('base64'),
  fetcher:async(url,opts)=>{
   const p=new URL(url).pathname;
   if(p==='/auth/v1/user')return json({id:id.actor});
   if(p.endsWith('/pitacco_ifood_connections'))return json([]);
   if(p.endsWith('/pitacco_ifood_linking_status'))return json(approved);
   if(p.endsWith('/oauth/userCode'))return json({
    userCode:'TEST-CODE',authorizationCodeVerifier:'private-verifier',expiresIn:600,verificationUrl:'https://portal.ifood.com.br/apps/code',
   });
   if(p.endsWith('/pitacco_ifood_begin_auth')){
    verifier=JSON.parse(opts.body).p_verifier;
    assert.ok(verifier&&!verifier.includes('private-verifier'));
    return json(id.attempt);
   }
   if(p.endsWith('/pitacco_ifood_take_auth')){
    assert.deepEqual(JSON.parse(opts.body),{p_ref:id.attempt,p_actor:id.actor,p_store:id.store});
    return json([{merchant_id:id.merchant,test_only:false,verifier}]);
   }
   if(p.endsWith('/oauth/token')){
    assert.equal(opts.body.get('authorizationCodeVerifier'),'private-verifier');
    return json({accessToken:'private-access',refreshToken:'private-refresh',expiresIn:3600});
   }
   if(p.endsWith('/merchants/'+id.merchant))return json(credentialAllowed?{id:id.merchant}:{id:id.order});
   if(p.endsWith('/pitacco_ifood_link_verified')){binding=JSON.parse(opts.body);return json(null);}
   if(p.endsWith('/pitacco_ifood_retry_authorized'))return json(true);
   if(p.endsWith('/pitacco_ifood_claim_poll'))return json([{merchant_id:id.merchant,credential:binding.p_credential,lease:id.attempt}]);
   if(p.endsWith('/events:polling')){
    assert.equal(opts.headers['x-polling-merchants'],id.merchant);
    assert.equal(opts.headers.authorization,'Bearer private-access');
    return json([event]);
   }
   if(p.endsWith('/pitacco_ifood_enqueue')){
    assert.equal(JSON.parse(opts.body).p_distributed,true);
    providerCalls.push('queued');
    return json(true);
   }
   if(p.endsWith('/events/acknowledgment')){
    assert.deepEqual(JSON.parse(opts.body),[{id:id.event}]);
    providerCalls.push('acknowledged');
    return new Response(null,{status:202});
   }
   if(p.endsWith('/pitacco_ifood_save_poll')){
    assert.equal(JSON.parse(opts.body).p_ok,true);
    return json(true);
   }
   if(p.endsWith('/pitacco_ifood_claim'))return json([]);
   if(p.endsWith('/pitacco_ifood_claim_auto_confirm'))return json([]);
   throw Error('unexpected '+p);
  },
 });
 const submit=input=>handler(new Request(endpoint+'/connect',{method:'POST',body:JSON.stringify({store:id.store,...input}),
  headers:{origin:'https://app.pitacco.com.br',authorization:'Bearer merchant-session'}}));
 approved=false;
 assert.equal((await submit({action:'start',merchant:id.merchant})).status,403);
 approved=true;
 const start=await submit({action:'start',merchant:id.merchant});
 assert.equal(start.status,200);
 assert.deepEqual(await start.json(),{reference:id.attempt,userCode:'TEST-CODE',portal:'https://portal.ifood.com.br/apps/code',seconds:600});
 assert.equal((await submit({action:'finish',reference:id.attempt,code:'authorized'})).status,403);
 assert.equal(binding,undefined);
 credentialAllowed=true;
 assert.equal((await submit({action:'finish',reference:id.attempt,code:'authorized'})).status,200);
 assert.equal(binding.p_store,id.store);
 assert.equal(binding.p_merchant,id.merchant);
 assert.equal(binding.p_test,false);
 assert.ok(!binding.p_credential.includes('private-access'));
 const retry=await handler(new Request(endpoint+'/retry',{method:'POST',headers:{'x-pitacco-queue-secret':id.attempt}}));
 assert.equal(retry.status,200);
 assert.deepEqual(providerCalls,['queued','acknowledged']);
});

test('auto-accept submits to the official iFood endpoint and waits for the provider event',async()=>{
 let outcome=202,submitCount=0;
 const settled=[];
 const handle=createIfoodOrders({...config,clientId:'central-id',clientSecret:'central-key',
  fetcher:async(url,opts)=>{
   const p=new URL(url).pathname;
   if(p.endsWith('/pitacco_ifood_retry_authorized'))return json(true);
   if(p.endsWith('/pitacco_ifood_claim'))return json([]);
   if(p.endsWith('/pitacco_ifood_claim_auto_confirm'))return json([
    {external_order_id:id.order,merchant_id:id.merchant,lease:id.attempt,uses_store_token:false},
   ]);
   if(p.endsWith('/oauth/token'))return json({accessToken:'central-access',expiresIn:3600});
   if(p.endsWith('/orders/'+id.order+'/confirm')){
    assert.equal(opts.method,'POST');assert.equal(opts.headers.authorization,'Bearer central-access');submitCount++;
    return new Response(null,{status:outcome});
   }
   if(p.endsWith('/pitacco_ifood_finish_auto_confirm')){settled.push(JSON.parse(opts.body));return json(null);}
   assert.fail('Unexpected path '+p);
  },
 });
 const request=()=>handle(new Request(endpoint+'/retry',{method:'POST',headers:{'x-pitacco-queue-secret':id.attempt}}));
 assert.equal((await request()).status,200);
 assert.deepEqual(settled[0],{p_order:id.order,p_lease:id.attempt,p_retry:false});
 outcome=503;
 assert.equal((await request()).status,200);
 assert.equal(settled[1].p_retry,true);
 assert.equal(submitCount,2);
});
