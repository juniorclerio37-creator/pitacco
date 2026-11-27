import test from 'node:test';
import assert from 'node:assert/strict';
import {createMerchantMap} from '../clients/merchant-map.mjs';
import {locateStoreByAddress} from '../../core-source/web/mapOrigin.mjs';
const store='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const p={id:store,name:'Fixture',latitude:-22.85,longitude:-43.45,saved:false};
function setup(){
 let current={...p};const calls=[];
 const map=createMerchantMap({store,token:'fixture',fetcher:async(url,opts)=>{
  calls.push([url,opts]);assert.equal(opts.headers.Authorization,'Bearer fixture');
  assert.equal(opts.cache,'no-store');assert.ok(url.startsWith('/api/v1/stores/'+store+'/'));
  if(opts.method==='PUT'){current={...current,...JSON.parse(opts.body),saved:true};}
  return {ok:true,json:async()=>({data:url.endsWith('/fleet-map')?{store:current,couriers:[],deliveries:[],positions:[],motion:[]}:current})};
 }});return {map,calls};
}
test('original store-origin helper and confirmed store-point share one canonical marker',async()=>{
 const {map,calls}=setup(),client={functions:{invoke:map.invoke}};
 assert.deepEqual(await locateStoreByAddress(client,store),{point:[-22.85,-43.45],approximate:false});
 const saved=await map.invoke('delivery-quote',{body:{action:'store-point',store_id:store,latitude:-22.84,longitude:-43.44}});
 assert.equal(saved.data.saved,true);assert.equal(saved.error,null);
 assert.deepEqual(JSON.parse(calls[1][1].body),{latitude:-22.84,longitude:-43.44,confirmed:true});
 assert.deepEqual(await map.readPoint(),{id:store,name:'Fixture',latitude:-22.84,longitude:-43.44});
 const fleet=await map.readFleet();assert.equal(fleet.store.latitude,-22.84);
 assert.deepEqual(Object.keys(await map.readPoint()).sort(),['id','latitude','longitude','name']);
});
test('other store and invalid point cannot send a request; no fallback or retry on revocation',async()=>{
 const {map,calls}=setup();
 assert.ok((await map.invoke('delivery-quote',{body:{action:'store-origin',store_id:other}})).error);
 await assert.rejects(map.savePoint(80,-43),/Brasil/);assert.equal(calls.length,0);
 let n=0;const revoked=createMerchantMap({store,token:'fixture',fetcher:async()=>{n++;return {status:403,ok:false};}});
 await assert.rejects(revoked.readPoint(),/não autorizado/);await assert.rejects(revoked.readFleet(),/encerrada/);assert.equal(n,1);
});
test('fleet foreign scope is rejected and concurrent reads coalesce',async()=>{
 let n=0;const bad=createMerchantMap({store,token:'fixture',fetcher:async()=>{n++;return {ok:true,json:async()=>({data:{store:p,couriers:[],deliveries:[{store_id:other,status:'retirada',logistics_provider:'loja'}],positions:[],motion:[]}})};}});
 const a=bad.readFleet(),b=bad.readFleet();assert.equal(a,b);await assert.rejects(a,/inconsistente/);assert.equal(n,1);
});
test('absent canonical point cannot be returned as confirmed',async()=>{
 const map=createMerchantMap({store,token:'fixture',fetcher:async()=>({ok:true,json:async()=>({data:{...p,latitude:null,longitude:null}})})});
 const client={functions:{invoke:map.invoke}};
 await assert.rejects(locateStoreByAddress(client,store),/ainda não localizado/);
});

test('missing point uses server-side lookup; approximate results remain proposals',async()=>{
 const calls=[];
 const map=createMerchantMap({store,token:'fixture',fetcher:async(url,opts)=>{
  calls.push([url,opts.method]);
  return {ok:true,json:async()=>({data:url.endsWith('/map-origin')?{latitude:-22.86,longitude:-43.46,approximate:true,saved:false,requires_confirmation:true}:{...p,latitude:null,longitude:null}})};
 }});
 const result=await locateStoreByAddress({functions:{invoke:map.invoke}},store);
 assert.deepEqual(result,{point:[-22.86,-43.46],approximate:true});
 assert.deepEqual(calls.map(x=>x[1]),['GET','POST']);
});
