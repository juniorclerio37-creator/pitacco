import test from 'node:test';
import assert from 'node:assert/strict';
import {createIfoodOrders} from '../supabase/functions/ifood-orders/handler.mjs';

const delivery='00000000-0000-0000-0000-000000000090';
const external='00000000-0000-0000-0000-000000000091';
const merchant='00000000-0000-0000-0000-000000000092';
const url='https://db.example.test/functions/v1/ifood-orders/driver-action';
const origin='https://entregador.pitacco.com.br';
const reply=(value,status=200)=>Response.json(value,{status});

function createHarness(providerStatus=200,providerBody={status:'VERIFIED'},scoped=true){
 const calls=[];
 const app=createIfoodOrders({
  clientId:'id',clientSecret:'secret',publicKey:'publishable',
  supabaseUrl:'https://db.example.test',serviceKey:'private',
  logger:{warn:()=>{}},
  fetcher:async (target,options={})=>{
   const path=new URL(target).pathname;
   calls.push({path,body:options.body,headers:options.headers});
   if(path.endsWith('/pitacco_driver_ifood_action')){
    assert.equal(options.headers.authorization,'Bearer courier-test-session');
    return scoped?reply({already:false,merchant_id:merchant,external_order_id:external}):reply({error:'not authorized'},403);
   }
   if(path.endsWith('/pitacco_ifood_poll_credential'))return reply(null);
   if(path.endsWith('/oauth/token'))return reply({accessToken:'token-mock',expiresIn:3600});
   if(path.includes('/arrivedAtDestination')||path.includes('/verifyDeliveryCode'))return reply(providerBody,providerStatus);
   if(path.endsWith('/pitacco_ifood_driver_result'))return reply(true);
   throw Error('Unexpected '+path);
  },
 });
 const call=(action,code)=>app(new Request(url,{
  method:'POST',headers:{origin,authorization:'Bearer courier-test-session','content-type':'application/json'},
  body:JSON.stringify({delivery,action,...(code?{code}:{})})
 }));
 return {calls,call,app};
}

test('arrival sends exact iFood logistics destination arrival with scoped order ID',async()=>{
 const {calls,call}=createHarness(202,{});
 const response=await call('arrival');
 assert.equal(response.status,200);
 assert.equal((await response.json()).provider_state,'submitted');
 const outbound=calls.find(x=>x.path.endsWith('/arrivedAtDestination'));
 assert.ok(outbound);
 assert.equal(outbound.path,'/logistics/v1.0/orders/'+external+'/arrivedAtDestination');
 assert.equal(outbound.body,'{}');
 assert.equal(calls.filter(x=>x.path.endsWith('/pitacco_ifood_driver_result')).length,1);
});

test('unscoped delivery is blocked before any marketplace request',async()=>{
 const {calls,call}=createHarness(200,{status:'VERIFIED'},false);
 const response=await call('arrival');
 assert.equal(response.status,403);
 assert.equal(calls.some(x=>x.path.includes('/logistics/')),false);
});

test('delivery code does not complete if provider only accepted async request',async()=>{
 const {calls,call}=createHarness(202,{status:'PENDING'});
 const response=await call('verify','1234');
 assert.equal(response.status,409);
 assert.equal(calls.some(x=>x.path.endsWith('/pitacco_ifood_driver_result')),false);
});

test('verified provider response completes only after service DB commit',async()=>{
 const {calls,call}=createHarness(200,{status:'VERIFIED'});
 const response=await call('verify','1234');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{verified:true,delivered:true});
 const outgoing=calls.find(x=>x.path.endsWith('/verifyDeliveryCode'));
 assert.equal(JSON.parse(outgoing.body).code,'1234');
 const committed=calls.find(x=>x.path.endsWith('/pitacco_ifood_driver_result'));
 assert.equal(JSON.parse(committed.body).p_success,true);
});

test('wrong provider code or invalid code never signals delivered',async()=>{
 const {calls,call}=createHarness(422,{error:'wrong code'});
 assert.equal((await call('verify','1234')).status,409);
 assert.equal((await call('verify','four')).status,400);
 assert.equal(calls.some(x=>x.path.endsWith('/pitacco_ifood_driver_result')),false);
});
test('preflight is limited to courier origin, without auth bypass',async()=>{
 const {app}=createHarness();
 const accepted=await app(new Request(url,{method:'OPTIONS',headers:{origin}}));
 assert.equal(accepted.status,204);
 const denied=await app(new Request(url,{method:'OPTIONS',headers:{origin:'https://evil.example'}}));
 assert.equal(denied.status,403);
});
