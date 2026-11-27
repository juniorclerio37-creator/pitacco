import test from 'node:test';
import assert from 'node:assert/strict';
import {createIfoodRoute} from '../clients/ifood-route.mjs';
const actor='10000000-0000-4000-8000-000000000001',route='30000000-0000-4000-8000-000000000001',one='40000000-0000-4000-8000-000000000001',two='40000000-0000-4000-8000-000000000002';
function setup(){
 let identity=actor,data={departed:true,pending_ifood_dispatch:[one,two]},status=200,provider=null;
 const calls=[],dispatches=[];
 const api=createIfoodRoute({actor,token:'core-fixture',legacyClient:{auth:{getUser:async()=>({data:{user:{id:identity}}})}},
  fetcher:async(path,opts)=>{assert.equal(path,'/api/v1/courier/ifood-route');assert.equal(opts.headers.Authorization,'Bearer core-fixture');assert.equal(opts.redirect,'error');calls.push(JSON.parse(opts.body));return {ok:status===200,status,json:async()=>({data})};},
  driverAction:async(id,action,code)=>{if(provider)return provider(id,action,code);assert.equal(action,'dispatch');dispatches.push(id);if(id===two)throw Error('fixture connection lost');return {provider_state:'submitted'};}});
 return {api,calls,dispatches,identity:v=>identity=v,data:v=>data=v,status:v=>status=v,provider:v=>provider=v};
}
test('collection never calls provider; local departure precedes provider dispatch; only server IDs',async()=>{
 const x=setup();x.data({collected:true});assert.deepEqual(await x.api.collect(one),{collected:true});assert.equal(x.dispatches.length,0);
 x.data({departed:true,pending_ifood_dispatch:[one,two]});
 assert.deepEqual(await x.api.depart(route),{departed:true,outcomes:[{id:one,state:'submitted'},{id:two,state:'uncertain'}]});
 assert.deepEqual(x.calls,[{action:'collect',delivery_id:one},{action:'depart_group',route_id:route}]);
 assert.deepEqual(x.dispatches,[one,two]);
 await x.api.depart(route);assert.deepEqual(x.dispatches,[one,two]);
});
test('rejected local departure and invalid response never dispatch',async()=>{
 const x=setup();x.status(409);await assert.rejects(x.api.depart(route),/não confirmada/);
 x.status(200);x.data({departed:false,pending_ifood_dispatch:[one]});await assert.rejects(x.api.depart(route),/não confirmada/);
 x.data({departed:true,pending_ifood_dispatch:[one,one]});await assert.rejects(x.api.depart(route),/lista inválida/);
 assert.equal(x.dispatches.length,0);
});
test('matching legacy identity required before local departure, concurrent action denied, stop',async()=>{
 const x=setup();x.identity(one);await assert.rejects(x.api.depart(route),/não corresponde/);assert.equal(x.calls.length,0);
 x.identity(actor);const p=x.api.depart(route);await assert.rejects(x.api.depart(route),/andamento/);await p;
 x.api.stop();await assert.rejects(x.api.depart(route),/encerrada/);
});

test('local arrival waits for official dispatch, then sends arrival once',async()=>{
 const x=setup(),events=[];
 x.provider(async(id,action)=>{events.push([id,action]);return {provider_state:'submitted'};});
 x.data({arrived_at:'fixture',provider_state:'pending',dispatch_confirmed:false});
 assert.deepEqual(await x.api.arrive(one),{arrived:true,provider_state:'pending_dispatch'});
 assert.deepEqual(events,[]);
 x.data({arrived_at:'fixture',provider_state:'pending',dispatch_confirmed:true});
 assert.deepEqual(await x.api.arrive(one),{arrived:true,provider_state:'submitted'});
 await x.api.arrive(one);assert.deepEqual(events,[[one,'arrival']]);
});
test('payment before PIN, leading zero preserved, invalid code may be corrected, uncertain never resubmitted',async()=>{
 const x=setup(),events=[];
 x.provider(async(id,action,code)=>{events.push([id,action,code]);if(code==='0123')throw Object.assign(Error('invalid'),{providerState:'invalid_code'});throw Error('network');});
 await assert.rejects(x.api.verify(one,'123'),/quatro dígitos/);
 x.status(409);await assert.rejects(x.api.verify(one,'0123'),/não confirmada/);
 assert.deepEqual(events,[]);
 x.status(200);x.data({state:'paid',received_by_courier:true});assert.equal((await x.api.confirmPayment(one)).state,'paid');
 x.data({eligible:true,delivered:false});
 assert.deepEqual(await x.api.verify(one,'0123'),{state:'invalid_code'});
 assert.deepEqual(await x.api.verify(one,'1234'),{state:'uncertain'});
 assert.deepEqual(await x.api.verify(one,'1234'),{state:'uncertain'});
 assert.deepEqual(events,[[one,'verify','0123'],[one,'verify','1234']]);
 x.data({eligible:false,delivered:true});assert.deepEqual(await x.api.verify(one,'1234'),{state:'already_delivered'});
});
test('only verified and persisted delivery reports verified',async()=>{
 const x=setup();x.data({eligible:true,delivered:false});x.provider(async()=>({verified:true,delivered:true}));
 assert.deepEqual(await x.api.verify(one,'0123'),{state:'verified'});
});
