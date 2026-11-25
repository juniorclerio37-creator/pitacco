import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchOptions,kmBetween} from '../dispatchOptions.mjs';
test('dispatch recommends available free courier and blocks stale/offline/full/in-flight',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z'),store={latitude:0,longitude:0,max_orders_per_trip:2};
 const couriers=['free','far','stale','offline','full','route'].map(id=>({id,name:id,fleet_type:'propria',available:id!=='offline'}));
 const positions=couriers.map(c=>({courier_id:c.id,latitude:0,longitude:c.id==='free'?.001:.01,observed_at:new Date(now-(c.id==='stale'?100000:1000)).toISOString()}));
 const stops=[{courier_id:'full',status:'aceita'},{courier_id:'full',status:'aceita'},{courier_id:'route',status:'retirada'}];
 const result=dispatchOptions({couriers,positions,stops,store,now});assert.equal(result[0].c.id,'free');assert.equal(result[1].c.id,'far');assert.ok(result.slice(2).every(x=>x.blocked));assert.equal(kmBetween(store,{latitude:null,longitude:0}),null);
});
