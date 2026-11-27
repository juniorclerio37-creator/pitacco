import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourierPickup} from '../clients/courier-pickup.mjs';
const id='98000000-0000-0000-0000-000000000021';
const delivery={id,source:'proprio',logistics_provider:'loja'};
function setup(payment,accept=true){
 const events=[];
 const api=createCourierPickup({token:'fixture',fetcher:async(path,opts)=>{
  assert.equal(path,'/api/v1/courier/payments');assert.equal(opts.headers.Authorization,'Bearer fixture');
  assert.deepEqual(JSON.parse(opts.body),{action:'unified_cards'});events.push('cards');
  return {ok:true,json:async()=>({data:[{delivery_id:id,payment}]})};},
  ownCollect:async v=>{events.push(['own',v]);return {collected:true};},
  ifoodCollect:async v=>{events.push(['ifood',v]);return {collected:true};},
  reminder:async(p,confirm)=>{events.push(['modal',p]);return accept?confirm():false;}});
 return {api,events};
}
test('original cash reminder receives the exact authoritative amount and change before collection',async()=>{
 const p={state:'collect',method:'Dinheiro',amount:34,change_for:50,change_due:16};
 const x=setup(p);assert.equal(await x.api.pickup(delivery),true);
 assert.deepEqual(x.events,['cards',['modal',p],['own',id]]);
});
test('original terminal reminder for iFood; back does not collect',async()=>{
 const p={state:'collect',method:'Cartão na entrega',amount:28};
 const x=setup(p,false);assert.equal(await x.api.pickup({...delivery,source:'ifood'}),false);
 assert.deepEqual(x.events,['cards',['modal',p]]);
 const y=setup(p);assert.equal(await y.api.pickup({...delivery,source:'ifood'}),true);
 assert.deepEqual(y.events,['cards',['modal',p],['ifood',id]]);
});
test('prepaid bypasses reminder, no collection when API payment missing or session stopped',async()=>{
 const x=setup({state:'paid',method:'Cartão na entrega',amount:28});assert.equal(await x.api.pickup(delivery),true);
 assert.deepEqual(x.events,['cards',['own',id]]);
 const y=setup(null);await assert.rejects(y.api.pickup(delivery),/Confira/);assert.deepEqual(y.events,['cards']);
 y.api.stop();assert.equal(await y.api.pickup(delivery),false);
});

test('concurrent prepaid collection remains locked until original operation resolves',async()=>{
 let resolve,calls=0;
 const pending=new Promise(r=>{resolve=r;});
 const api=createCourierPickup({token:'fixture',fetcher:async()=>({ok:true,json:async()=>({data:[{delivery_id:id,payment:{state:'paid',method:'Online',amount:28}}]})}),
 ownCollect:async()=>{calls++;return pending;},ifoodCollect:async()=>{throw Error('wrong source');}});
 const first=api.pickup(delivery);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(await api.pickup(delivery),false);
 resolve({collected:true});assert.equal(await first,true);assert.equal(calls,1);
});
