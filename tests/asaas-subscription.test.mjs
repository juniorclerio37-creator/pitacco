import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAsaasWebhook} from '../supabase/functions/asaas-subscription-webhook/handler.mjs';

const token='sandbox-webhook-token-with-more-than-32-characters';
const paymentId='pay_reference';
const subscriptionId='sub_reference';
const config={
 environment:'sandbox',token,apiKey:'provider-test-only',
 supabaseUrl:'https://fixture.supabase.invalid',serviceKey:'service-test-only'
};
const endpoint='https://pitacco.example.invalid/webhook';
const verified={id:paymentId,subscription:subscriptionId,status:'RECEIVED',value:59.90};
const event={event:'PAYMENT_RECEIVED',payment:{id:paymentId,subscription:'sub_other',value:170}};
const request=(input=event,auth=token)=>new Request(endpoint,{
 method:'POST',headers:{'asaas-access-token':auth},body:JSON.stringify(input)
});

test('rejects requests without provider authentication before doing network I/O',async()=>{
 const handler=createAsaasWebhook({...config,fetcher:()=>assert.fail('Network call with invalid token')});
 assert.equal((await handler(new Request(endpoint))).status,405);
 assert.equal((await handler(request(event,'incorrect'))).status,401);
 assert.equal((await handler(request({...event,event:'PAYMENT_CREATED'}))).status,200);
});

test('verifies the charge with Asaas and maps the verified subscription, not the notification fields',async()=>{
 const calls=[];
 const handler=createAsaasWebhook({...config,fetcher:(url,options)=>{
  calls.push({url,options});
  return Promise.resolve(Response.json(calls.length===1?verified:'2026-12-14T23:00:00Z'));
 }});
 const result=await handler(request());
 assert.deepEqual(await result.json(),{outcome:'processed'});
 assert.equal(calls[0].url.href,'https://api-sandbox.asaas.com/v3/payments/'+paymentId);
 assert.equal(calls[0].options.headers.access_token,config.apiKey);
 assert.equal(calls[1].url.href,config.supabaseUrl+'/rest/v1/rpc/pitacco_record_asaas_subscription_payment');
 assert.deepEqual(JSON.parse(calls[1].options.body),{
  p_environment:'sandbox',p_subscription_id:subscriptionId,p_payment_id:paymentId,p_amount:59.90
 });
});

test('never credits an unconfirmed, partial, unmatched or nonsubscription payment',async()=>{
 for(const changes of [{status:'PENDING'},{status:'REFUNDED'},{value:15},{id:'pay_other'},{subscription:null}]){
  let calls=0;
  const handler=createAsaasWebhook({...config,fetcher:()=>{
   calls++;
   return Promise.resolve(Response.json({...verified,...changes}));
  }});
  assert.deepEqual(await (await handler(request())).json(),{outcome:'payment_not_eligible'});
  assert.equal(calls,1);
 }
});

test('distinguishes a retryable database failure from an unrelated subscription',async()=>{
 for(const [receipt,status,outcome] of [
  [Response.json(null),200,'subscription_not_linked'],
  [Response.json({message:'internal data'},{status:500}),503,'subscription_sync_unavailable']
 ]){
  let calls=0;
  const handler=createAsaasWebhook({...config,fetcher:()=>Promise.resolve(++calls===1?Response.json(verified):receipt)});
  const response=await handler(request());
  assert.equal(response.status,status);
  assert.deepEqual(await response.json(),{outcome});
 }
});
