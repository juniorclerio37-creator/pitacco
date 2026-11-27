import test from 'node:test';
import assert from 'node:assert/strict';
import {readCoreTracking,readCoreTrackingRpc} from '../clients/tracking.mjs';
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

test('original tracking RPC shape distinguishes expired token from transient failure',async()=>{
 const args={p_token:token};
 assert.deepEqual(await readCoreTrackingRpc(args,{fetcher:async(path,opt)=>{
  assert.equal(path,'/api/v1/public/orders/tracking');
  assert.deepEqual(JSON.parse(opt.body),{tracking_token:token});
  return new Response(JSON.stringify({data}),{status:200});
 }}),{data,error:null});
 assert.deepEqual(await readCoreTrackingRpc(args,{fetcher:async()=>new Response('',{status:404})}),{data:null,error:null});
 for(const status of [403,429,503]){
  const r=await readCoreTrackingRpc(args,{fetcher:async()=>new Response(token,{status})});
  assert.equal(r.data,null);assert.ok(r.error.message);assert.ok(!JSON.stringify(r).includes(token));
 }
 assert.deepEqual(await readCoreTrackingRpc({p_token:'bad'},{fetcher:()=>assert.fail('unexpected fetch')}),{data:null,error:null});
 assert.ok((await readCoreTrackingRpc({...args,p_store:'other'},{fetcher:()=>assert.fail('unexpected fetch')})).error);
});
