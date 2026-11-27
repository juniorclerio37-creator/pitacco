import test from 'node:test';
import assert from 'node:assert/strict';
import {createShippingSimulation} from '../clients/shipping-simulation.mjs';
const now=1795800000000;
const quote={environment:'simulation',homologated:false,request_enabled:false,quote:{simulated:true,net_value_cents:1200,expires_at:new Date(now+60000).toISOString()}};
const make=()=>createShippingSimulation(quote,{now:()=>now});
test('unhomologated simulation only; price confirmation and expiry',()=>{
 assert.throws(()=>createShippingSimulation({...quote,environment:'production'}));
 assert.throws(()=>createShippingSimulation({...quote,quote:{...quote.quote,id:'provider'}}));
 const x=make();assert.throws(()=>x.request(false,1200));assert.throws(()=>x.request(true,1199));
 assert.throws(()=>createShippingSimulation(quote,{now:()=>now+60000}).request(true,1200));
 assert.equal(x.request(true,1200).own_available,false);
 assert.throws(()=>x.request(true,1200));
});
test('uncertain request holds own fleet until simulated allocation and cancellation proof',()=>{
 const x=make();x.request(true,1200);x.response('uncertain');
 assert.equal(x.snapshot().own_available,false);assert.throws(()=>x.requestCancel(true));
 x.simulatedEvent({kind:'allocated',sequence:1});
 x.requestCancel(true);x.cancelResponse('uncertain');
 assert.equal(x.snapshot().own_available,false);assert.throws(()=>x.requestCancel(true));
 const result=x.simulatedEvent({kind:'cancel_confirmed',sequence:2});
 assert.equal(result.state,'cancelled');assert.equal(result.own_available,true);
 assert.equal(result.order_preserved,true);assert.equal(result.commercial_enabled,false);
 assert.deepEqual(x.simulatedEvent({kind:'allocated',sequence:1}),result);
});
test('rejected reservation releases own logistics, rejected cancellation does not; transit blocks cancellation',()=>{
 const x=make();x.request(true,1200);assert.equal(x.response('rejected').own_available,true);
 const y=make();y.request(true,1200);y.response('submitted');y.requestCancel(true);y.cancelResponse('rejected');
 assert.equal(y.snapshot().own_available,false);y.simulatedEvent({kind:'allocated',sequence:1});y.simulatedEvent({kind:'in_transit',sequence:2});
 assert.throws(()=>y.requestCancel(true));assert.equal(y.snapshot().order_preserved,true);
});
