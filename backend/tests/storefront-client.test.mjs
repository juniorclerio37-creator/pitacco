import test from 'node:test';
import assert from 'node:assert/strict';
import {readCoreMenu,placeCoreOrder,recoverCoreOrder} from '../clients/storefront.mjs';
const request_id='10000000-0000-4000-8000-000000000001';
const receipt={order_id:'20000000-0000-4000-8000-000000000001',tracking_token:'30000000-0000-4000-8000-000000000001',total:25};
const cart=Object.freeze({request_id,payment:'pix_manual',fulfillment:'pickup',items:[]});
const json=(data,status=200)=>new Response(JSON.stringify({data}),{status});
test('menu is same-origin and verifies store slug',async()=>{
  const data={store:{slug:'fixture'},products:[]};
  assert.deepEqual(await readCoreMenu('fixture',{fetcher:async(path,opt)=>{
    assert.equal(path,'/api/v1/public/menus/fixture');
    assert.equal(opt.method,'GET');assert.equal(opt.cache,'no-store');
    assert.equal(opt.credentials,'omit');assert.equal(opt.redirect,'error');
    return json(data);
  }}),{state:'ready',data});
  assert.equal((await readCoreMenu('fixture',{fetcher:async()=>json({store:{slug:'other'},products:[]})})).state,'retry');
  assert.equal((await readCoreMenu('../other',{fetcher:()=>assert.fail('unexpected request')})).state,'unavailable');
});
test('checkout keeps the caller request ID and never retries on failure',async()=>{
  let calls=0;
  const result=await placeCoreOrder('fixture',cart,{fetcher:async(path,opt)=>{
    calls++;assert.equal(path,'/api/v1/public/menus/fixture/checkout');
    assert.deepEqual(JSON.parse(opt.body),cart);assert.equal(opt.method,'POST');
    assert.equal(opt.credentials,'omit');assert.equal(opt.referrerPolicy,'no-referrer');
    throw Error('synthetic connection failure');
  }});
  assert.equal(calls,1);assert.deepEqual(result,{state:'uncertain',data:null});
  assert.equal((await placeCoreOrder('fixture',cart,{fetcher:async()=>json({})})).state,'uncertain');
  assert.deepEqual(await placeCoreOrder('fixture',cart,{fetcher:async()=>json(receipt)}),{state:'confirmed',data:receipt});
  for(const [status,state] of [[409,'rejected'],[422,'invalid'],[429,'rate_limited'],[503,'uncertain']]){
    assert.deepEqual(await placeCoreOrder('fixture',cart,{fetcher:async()=>json({},status)}),{state,data:null});
  }
});
test('recovery is explicit and scoped to the original request',async()=>{
  const data={...receipt,confirmed:true};
  assert.deepEqual(await recoverCoreOrder('fixture',request_id,{fetcher:async(path,opt)=>{
    assert.equal(path,'/api/v1/public/menus/fixture/checkout/recovery');
    assert.deepEqual(JSON.parse(opt.body),{request_id});
    return json(data);
  }}),{state:'confirmed',data});
  assert.equal((await recoverCoreOrder('fixture',request_id,{fetcher:async()=>json({confirmed:false})})).state,'not_found');
  assert.equal((await recoverCoreOrder('fixture',request_id,{fetcher:async()=>json({},503)})).state,'uncertain');
});
