import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createIfoodOrders} from '../supabase/functions/ifood-orders/handler.mjs';

const delivery='00000000-0000-0000-0000-000000000090';
const external='00000000-0000-0000-0000-000000000091';
const merchant='00000000-0000-0000-0000-000000000092';
const url='https://db.example.test/functions/v1/ifood-orders/driver-action';
const origin='https://entregador.pitacco.com.br';
const reply=(value,status=200)=>Response.json(value,{status});

function createHarness(providerStatus=200,providerBody={valid:true},scoped=true,persisted=true){
 const calls=[];
 const app=createIfoodOrders({
  clientId:'id',clientSecret:'secret',publicKey:'publishable',
  supabaseUrl:'https://db.example.test',serviceKey:'private',
  logger:{warn:()=>{}},
  fetcher:async (target,options={})=>{
   const path=new URL(target).pathname;
   calls.push({path,body:options.body,headers:options.headers});
   if(path.endsWith('/pitacco_driver_ifood_dispatch_claim_v2')){
    assert.equal(options.headers.authorization,'Bearer courier-test-session');
    return scoped?reply({status:'claimed',lease:'00000000-0000-4000-8000-000000000093',
      merchant_id:merchant,external_order_id:external,ready_on_ifood:true}):
      reply({error:'only merchant courier'},403);
   }
   if(path.endsWith('/pitacco_ifood_dispatch_begin'))return reply(true);
   if(path.endsWith('/pitacco_ifood_dispatch_result'))return reply(true);
   if(path.endsWith('/dispatch'))return reply({},202);
   if(path.endsWith('/readyToPickup'))return reply({},202);
   if(path.endsWith('/pitacco_driver_ifood_action')){
    assert.equal(options.headers.authorization,'Bearer courier-test-session');
    return scoped?reply({already:false,merchant_id:merchant,external_order_id:external}):reply({error:'not authorized'},403);
   }
   if(path.endsWith('/pitacco_ifood_poll_credential'))return reply(null);
   if(path.endsWith('/oauth/token'))return reply({accessToken:'token-mock',expiresIn:3600});
   if(path.includes('/arrivedAtDestination')||path.includes('/verifyDeliveryCode'))return reply(providerBody,providerStatus);
   if(path.endsWith('/pitacco_ifood_driver_result'))return reply(persisted);
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
 const {calls,call}=createHarness(200,{valid:true},false);
 const response=await call('arrival');
 assert.equal(response.status,403);
 assert.equal(calls.some(x=>x.path.includes('/logistics/')),false);
});

test('delivery code does not complete if provider only accepted async request',async()=>{
 const {calls,call}=createHarness(202,{valid:true});
 const response=await call('verify','1234');
 assert.equal(response.status,503);
 assert.equal((await response.json()).provider_state,'not_confirmed');
 assert.equal(calls.some(x=>x.path.endsWith('/pitacco_ifood_driver_result')),false);
});

test('verified provider response completes only after service DB commit',async()=>{
 const {calls,call}=createHarness(200,{valid:true});
 const response=await call('verify','1234');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{verified:true,delivered:true});
 const outgoing=calls.find(x=>x.path.endsWith('/verifyDeliveryCode'));
 assert.equal(outgoing.path,'/order/v1.0/orders/'+external+'/verifyDeliveryCode');
 assert.equal(JSON.parse(outgoing.body).code,'1234');
 const committed=calls.find(x=>x.path.endsWith('/pitacco_ifood_driver_result'));
 assert.equal(JSON.parse(committed.body).p_success,true);
});

test('wrong provider code or invalid code never signals delivered',async()=>{
 const {calls,call}=createHarness(200,{valid:false});
 const rejected=await call('verify','1234');
 assert.equal(rejected.status,409);
 assert.equal((await rejected.json()).provider_state,'invalid_code');
 assert.equal((await call('verify','four')).status,400);
 assert.equal((await call('verify','123')).status,400);
 assert.equal((await call('verify','12345')).status,400);
 assert.equal((await call('verify','12345678')).status,400);
 assert.equal(calls.some(x=>x.path.endsWith('/pitacco_ifood_driver_result')),false);
});
test('preflight is limited to courier origin, without auth bypass',async()=>{
 const {app}=createHarness();
 const accepted=await app(new Request(url,{method:'OPTIONS',headers:{origin}}));
 assert.equal(accepted.status,204);
 const denied=await app(new Request(url,{method:'OPTIONS',headers:{origin:'https://evil.example'}}));
 assert.equal(denied.status,403);
});

test('a 200 response without valid:true never completes delivery',async()=>{
 const {calls,call}=createHarness(200,{status:'VERIFIED'});
 const response=await call('verify','1234');
 assert.equal(response.status,503);
 assert.equal((await response.json()).provider_state,'not_confirmed');
 assert.equal(calls.some(x=>x.path.endsWith('/pitacco_ifood_driver_result')),false);
});

test('merchant courier departure calls /dispatch with deliveredBy MERCHANT after scoped claim',async()=>{
 const {calls,call}=createHarness();
 const response=await call('dispatch');
 assert.equal(response.status,202);
 assert.equal((await response.json()).provider_state,'submitted');
 const claim=calls.find(x=>x.path.endsWith('/pitacco_driver_ifood_dispatch_claim_v2'));
 const sent=calls.find(x=>x.path.endsWith('/dispatch'));
 assert.ok(claim&&sent);
 assert.ok(JSON.parse(claim.body).p_request);
 assert.ok(calls.findIndex(x=>x.path.endsWith('/pitacco_ifood_dispatch_begin'))<calls.indexOf(sent));
 assert.equal(sent.path,'/order/v1.0/orders/'+external+'/dispatch');
 assert.deepEqual(JSON.parse(sent.body),{deliveredBy:'MERCHANT'});
 assert.equal(calls.filter(x=>x.path.endsWith('/pitacco_ifood_dispatch_result')).length,1);
});

test('partner-delivery or unscoped courier is rejected before any iFood dispatch',async()=>{
 const {calls,call}=createHarness(200,{valid:true},false);
 const response=await call('dispatch');
 assert.equal(response.status,403);
 assert.equal(calls.some(x=>x.path.endsWith('/dispatch')),false);
});

test('coleta não envia DISPATCHED; sair para entrega dispara o envio próprio',()=>{
 const page=readFileSync(new URL('../entregador/painel.html',import.meta.url),'utf8');
 const collect=page.slice(page.indexOf('async function collectCourierOrder(d){'),
  page.indexOf('async function sendIfoodDispatch(d){'));
 assert.match(collect,/sb\.rpc\("pitacco_driver_collect"/);
 assert.doesNotMatch(collect,/ifoodDriverAction\(d\.id,"dispatch"\)/);
 assert.match(page,/createAction\("Sair para entrega","primary",\(\)=>departCourierRoute\(d\)\)/);
 assert.match(page,/sendIfoodDispatch\(stop\)/);
 assert.match(page,/recordDepartureAndDispatch\(/);
 assert.match(page,/Sincronizar despacho com iFood/);
});

test('provider conflicts and access errors never claim an incorrect code',async()=>{
 for(const [upstream,http] of [[401,503],[403,503],[404,409],[409,409],[412,409],[422,409],[429,503],[500,503]]){
  const {calls,call}=createHarness(upstream,{valid:false});
  const response=await call('verify','1234');
  assert.equal(response.status,http);
  const data=await response.json();
  assert.equal(data.provider_state,'not_confirmed');
  assert.doesNotMatch(data.error,/código incorreto|não validou esse código/i);
  assert.equal(calls.some(x=>x.path.endsWith('/pitacco_ifood_driver_result')),false);
 }
});

test('iFood acceptance never reports completed when local commit refuses the transition',async()=>{
 const {call}=createHarness(200,{valid:true},true,false);
 const response=await call('verify','1234');
 assert.equal(response.status,409);
 const data=await response.json();
 assert.equal(data.delivered,undefined);
 assert.match(data.error,/entrega mudou de estado/);
});
