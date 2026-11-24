import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCommercialPayment } from '../commercial-candidate.mjs';
const payment={id:'pay_test',customer:'cus_test',value:17.49,status:'RECEIVED',externalReference:'pitacco:commercial:12345678-1234-1234-1234-123456789abc'};
const opts={payment,environment:'production',supabaseUrl:'https://example.invalid',serviceKey:'test-only'};
test('uses integer cents and the trusted provider reference, without assuming a fixed monthly price',async()=>{
 const result=await reconcileCommercialPayment({...opts,fetcher:async(url,init)=>{
  assert.equal(url.pathname,'/rest/v1/rpc/pitacco_reconcile_commercial_asaas_charge');
  assert.equal(init.method,'POST');
  assert.deepEqual(JSON.parse(init.body),{p_environment:'production',p_payment_id:'pay_test',p_customer_id:'cus_test',p_reference:payment.externalReference,p_amount_cents:1749,p_status:'RECEIVED'});
  return Response.json('received');
 }});
 assert.equal(result,'received');
});
test('ignores unrelated charges without calling the database',async()=>{
 assert.equal(await reconcileCommercialPayment({...opts,payment:{...payment,externalReference:'other'},fetcher:()=>{throw Error('unexpected request')}}),null);
});
test('rejects invalid amount and identity before network access',async()=>{
 for(const change of [{value:17.491},{value:-1},{value:NaN},{customer:'invalid'},{id:'bad'}]){
  await assert.rejects(reconcileCommercialPayment({...opts,payment:{...payment,...change},fetcher:()=>{throw Error('unexpected request')}}),/invalid_provider/);
 }
});
test('propagates database failures for retry, rather than claiming successful settlement',async()=>{
 await assert.rejects(reconcileCommercialPayment({...opts,fetcher:()=>new Response(null,{status:503})}),/commercial_sync_unavailable/);
});
test('preserves review outcome on reversal',async()=>{
 assert.equal(await reconcileCommercialPayment({...opts,payment:{...payment,status:'REFUNDED'},fetcher:()=>Response.json('review_required')}),'review_required');
});
