import test from 'node:test';
import assert from 'node:assert/strict';
import {readCoreTracking} from '../clients/tracking.mjs';
const token='10000000-0000-4000-8000-000000000001';
const data={order_id:'20000000-0000-4000-8000-000000000001',status:'accepted',courier_position:null};
test('same-origin POST, no credentials, no cache, no token in URL',async()=>{
  const result=await readCoreTracking(token,{fetcher:async(url,options)=>{
    assert.equal(url,'/api/v1/public/orders/tracking');
    assert.equal(options.method,'POST');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert.equal(options.redirect,'error');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.deepEqual(JSON.parse(options.body),{tracking_token:token});
    return new Response(JSON.stringify({data}),{status:200});
  }});
  assert.deepEqual(result,{state:'ready',data});
});
test('invalid capability does not send a request',async()=>{
  assert.deepEqual(await readCoreTracking('bad',{fetcher:()=>assert.fail('unexpected network')}),{state:'unavailable',data:null});
});
test('HTTP and network errors do not expose token or stale data',async()=>{
  for(const [status,state] of [[404,'unavailable'],[429,'rate_limited'],[503,'retry'],[403,'retry']]){
    assert.deepEqual(await readCoreTracking(token,{fetcher:async()=>new Response(token,{status})}),{state,data:null});
  }
  assert.deepEqual(await readCoreTracking(token,{fetcher:async()=>{throw Error(token)}}),{state:'retry',data:null});
  assert.deepEqual(await readCoreTracking(token,{fetcher:async()=>new Response('{"data":{}}')}),{state:'retry',data:null});
});
