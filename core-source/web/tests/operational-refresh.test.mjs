import test from 'node:test';
import assert from 'node:assert/strict';
import {connectOperationalRefresh} from '../operationalRefresh.mjs';
function setup(source=null,broken=false){
 let refreshes=0,removed=0,interval,cleared=0,subscriptions=[],subscribe;
 const channel={on(type,filter,cb){subscriptions.push({type,filter,cb});return this;},subscribe(cb){subscribe=cb;return this;}};
 const stop=connectOperationalRefresh({client:{channel(name){assert.equal(name,'operations:store-a');if(broken)throw Error();return channel;},
 removeChannel(c){assert.equal(c,channel);removed++;return Promise.resolve();}},storeId:'store-a',
 refresh(){refreshes++;},experimentalSource:source,schedule(fn,delay){assert.equal(delay,5000);interval=fn;return 1;},cancel(id){assert.equal(id,1);cleared++;}});
 return {stop,subscriptions,interval,subscribed:()=>subscribe?.('SUBSCRIBED'),stats:()=>({refreshes,removed,cleared})};
}
test('original store signals, polling, subscription refresh and cleanup are preserved',()=>{
 const x=setup();assert.equal(x.stats().refreshes,1);
 assert.deepEqual(x.subscriptions.map(s=>s.filter),[
 {event:'*',schema:'public',table:'orders',filter:'store_id=eq.store-a'},
 {event:'*',schema:'public',table:'deliveries',filter:'store_id=eq.store-a'}]);
 x.subscribed();x.subscriptions[0].cb();x.subscriptions[1].cb();x.interval();
 assert.equal(x.stats().refreshes,5);
 x.stop();x.stop();x.interval();x.subscriptions[0].cb();x.subscribed();
 assert.deepEqual(x.stats(),{refreshes:5,removed:1,cleared:1});
});
test('unavailable realtime retains polling',()=>{
 const x=setup(null,true);x.interval();x.stop();
 assert.deepEqual(x.stats(),{refreshes:2,removed:0,cleared:1});
});
test('explicit compatible source refreshes the same full board and is cleaned up',()=>{
 let signal,closed=0;
 const x=setup({storeId:'store-a',sameDataset:true,subscribe(cb){signal=cb;return ()=>closed++;}});
 assert.equal(x.subscriptions.length,0);signal({untrusted:'not an order'});x.interval();
 assert.equal(x.stats().refreshes,3);
 x.stop();signal();x.interval();assert.equal(closed,1);assert.equal(x.stats().refreshes,3);
});
test('foreign or unconfirmed source never starts; failing source falls back',()=>{
 for(const source of [{storeId:'store-b',sameDataset:true},{storeId:'store-a',sameDataset:false}]){
 const x=setup({...source,subscribe(){assert.fail('must not subscribe');}});assert.equal(x.subscriptions.length,2);x.stop();}
 const x=setup({storeId:'store-a',sameDataset:true,subscribe(){throw Error();}});
 assert.equal(x.subscriptions.length,2);x.stop();
});
