import test from 'node:test';
import assert from 'node:assert/strict';
import {readCoreMenu,placeCoreOrder,recoverCoreOrder,readCoreSchedule,readCoreScheduleRpc,readCoreStoreStateRpc} from '../clients/storefront.mjs';
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

test('offline payment methods are forwarded without substitution; specialized methods remain excluded',async()=>{
 for(const payment of ["pix_manual","dinheiro","cartao_credito","cartao_debito","cartao_entrega","pix_maquininha","voucher_alelo","voucher_pluxee","voucher_vr","voucher_ticket"]){
   const result=await placeCoreOrder('fixture',{...cart,payment},{fetcher:async(path,opt)=>{
     assert.equal(JSON.parse(opt.body).payment,payment);
     return json(receipt);
   }});
   assert.equal(result.state,'confirmed');
 }
 for(const payment of ['fiado','pix_online','cartao_online','unknown']){
   assert.equal((await placeCoreOrder('fixture',{...cart,payment},{fetcher:()=>assert.fail('unexpected request')})).state,'invalid');
 }
});

test('schedule uses original server slots, preserves offset and rejects invalid data',async()=>{
 const data={timezone:'America/Sao_Paulo',slots:['2026-11-28T14:00:00-03:00','2026-11-28T14:30:00-03:00']};
 for(const mode of ['pickup','delivery']){
  assert.deepEqual(await readCoreSchedule('fixture',mode,{fetcher:async(path,opt)=>{
   assert.equal(path,'/api/v1/public/menus/fixture/schedule-slots?fulfillment='+mode);
   assert.equal(opt.method,'GET');assert.equal(opt.cache,'no-store');assert.equal(opt.credentials,'omit');
   return json(data);
  }}),{state:'ready',data});
 }
 for(const slots of [[data.slots[0],data.slots[0]],data.slots.slice().reverse(),['invalid'],['2026-11-28T17:00:00Z']]){
   assert.equal((await readCoreSchedule('fixture','pickup',{fetcher:async()=>json({...data,slots})})).state,'retry');
 }
 assert.equal((await readCoreSchedule('fixture','pickup',{fetcher:async()=>json({...data,slots:[]})})).state,'ready');
 assert.equal((await readCoreSchedule('fixture','pickup',{fetcher:async()=>json({},429)})).state,'rate_limited');
 assert.equal((await readCoreSchedule('fixture','pickup',{fetcher:async()=>{throw Error('offline')}})).state,'retry');
 assert.equal((await readCoreSchedule('fixture','invalid',{fetcher:()=>assert.fail('unexpected request')})).state,'invalid');
});

test('V2 schedule compatibility returns original RPC shape without another upstream',async()=>{
 const args={p_slug:'fixture',p_fulfillment:'delivery'};
 const slots=['2026-11-28T14:00:00-03:00'];
 let calls=0;
 const result=await readCoreScheduleRpc(args,{fetcher:async(path,opt)=>{
   calls++;assert.equal(path,'/api/v1/public/menus/fixture/schedule-slots?fulfillment=delivery');
   return json({timezone:'America/Sao_Paulo',slots});
 }});
 assert.deepEqual(result,{data:slots,error:null});
 assert.equal(calls,1);
 assert.deepEqual(await readCoreScheduleRpc(args,{fetcher:async()=>json({},503)}),{data:null,error:{code:'retry'}});
 assert.deepEqual(await readCoreScheduleRpc({...args,store_id:'other'},{fetcher:()=>assert.fail('unexpected request')}),{data:null,error:{code:'invalid'}});
});

test('V2 refresh reads only explicitly allowed public projections',async()=>{
 const args={p_slug:'fixture'};
 const opening={open:false,reason:'paused',accepts_scheduled:false};
 const rules={pix_manual:{adjustment_bps:-100,revision:3}};
 for(const [name,resource,data] of [['pitacco_public_store_open','opening',opening],['pitacco_public_payment_price_rules','payment-prices',rules]]){
  assert.deepEqual(await readCoreStoreStateRpc(name,args,{fetcher:async(path,opt)=>{
   assert.equal(path,'/api/v1/public/menus/fixture/'+resource);
   assert.equal(opt.method,'GET');assert.equal(opt.cache,'no-store');
   return json(data);
  }}),{data,error:null});
  assert.deepEqual(await readCoreStoreStateRpc(name,args,{fetcher:async()=>json({},503)}),{data:null,error:{code:'retry'}});
 }
 assert.deepEqual(await readCoreStoreStateRpc('pitacco_public_payment_price_rules',args,{fetcher:async()=>json({})}),{data:{},error:null});
 assert.equal((await readCoreStoreStateRpc('pitacco_public_store_open',args,{fetcher:async()=>json({open:'true'})})).error.code,'retry');
 assert.equal((await readCoreStoreStateRpc('pitacco_public_payment_price_rules',args,{fetcher:async()=>json({pix_manual:{adjustment_bps:100,revision:'3'}})})).error.code,'retry');
 assert.equal((await readCoreStoreStateRpc('arbitrary_rpc',args,{fetcher:()=>assert.fail('unexpected request')})).error.code,'invalid');
});
