import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchOptions,kmBetween,routeDestinationRelation,routeDestinationSummary,routeDestinationMessage} from '../dispatchOptions.mjs';
test('dispatch recommends available free courier and blocks stale/offline/full/in-flight',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z'),store={latitude:0,longitude:0,max_orders_per_trip:2};
 const couriers=['free','far','stale','offline','full','route'].map(id=>({id,name:id,fleet_type:'propria',available:id!=='offline'}));
 const positions=couriers.map(c=>({courier_id:c.id,latitude:0,longitude:c.id==='free'?.001:.01,observed_at:new Date(now-(c.id==='stale'?100000:1000)).toISOString()}));
 const stops=[{courier_id:'full',status:'aceita'},{courier_id:'full',status:'aceita'},{courier_id:'route',status:'retirada'}];
 const result=dispatchOptions({couriers,positions,stops,store,now});assert.equal(result[0].c.id,'free');assert.equal(result[1].c.id,'far');assert.ok(result.slice(2).every(x=>x.blocked));assert.equal(kmBetween(store,{latitude:null,longitude:0}),null);
});

test('same numbered address is recognized without geocoding, with normalized accents and punctuation',()=>{
 const a={address:'Rua Exemplo, 97, Fundos, Centro, Nova Iguaçu/RJ'},b={address:'RUA EXEMPLO 97 FUNDOS CENTRO NOVA IGUACU RJ'};
 assert.equal(routeDestinationRelation(a,b),'same');
 assert.match(routeDestinationMessage(routeDestinationSummary([a,b])),/Mesmo endereço/);
 assert.equal(routeDestinationRelation(a,{...b,address:'Rua Exemplo, 98, Fundos, Centro, Nova Iguaçu/RJ'}),'check');
 assert.equal(routeDestinationRelation({address:'Centro'},{address:'Centro'}),'check');
 assert.equal(routeDestinationRelation({address:'Rua Exemplo, 97, Centro, Nova Iguaçu/RJ',latitude:-22.70,longitude:-43.45},{address:'Rua Exemplo, 97, Centro, Nova Iguaçu/RJ',latitude:-22.72,longitude:-43.45}),'check');
});
test('nearby destinations are not labeled identical, and third distant stop requires review',()=>{
 const a={latitude:-22.70,longitude:-43.45},b={latitude:-22.7002,longitude:-43.45},c={latitude:-22.72,longitude:-43.45};
 assert.equal(routeDestinationSummary([a,b]),'nearby');
 assert.equal(routeDestinationSummary([a,b,c]),'check');
 assert.equal(routeDestinationRelation({latitude:0,longitude:0},{latitude:0,longitude:0}),'check');
 assert.equal(routeDestinationSummary([a,undefined]),'check');
 assert.doesNotMatch(routeDestinationMessage('check'),/oposta|contrária/);
});

test('manual dispatch allows a full pre-departure route while automation still blocks it',()=>{
 const now=Date.now(),store={max_orders_per_trip:1};
 const couriers=[{id:'c',name:'Courier',fleet_type:'propria',active:true,available:true}];
 const positions=[{courier_id:'c',latitude:-22.7,longitude:-43.45,observed_at:new Date(now).toISOString()}];
 const stops=[{courier_id:'c',status:'aceita'}];
 const data={couriers,positions,stops,store,now};
 assert.equal(dispatchOptions(data)[0].blocked,true);
 assert.equal(dispatchOptions({...data,manual:true})[0].blocked,false);
 assert.equal(dispatchOptions({...data,manual:true})[0].full,true);
 assert.equal(dispatchOptions({...data,manual:true,stops:[{courier_id:'c',status:'retirada'}]})[0].blocked,true);
});
