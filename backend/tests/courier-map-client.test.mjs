import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourierMapReader} from '../clients/courier-map.mjs';
const base={origins:[{store_id:'s',latitude:-22.85,longitude:-43.45}],deliveries:[{id:'a',store_id:'s',status:'aceita',source:'proprio',logistics_provider:'loja',batch_id:'b',latitude:-22.84,longitude:-43.45,public_number:'1'},{id:'c',store_id:'s',status:'aceita',source:'ifood',logistics_provider:'loja',batch_id:'b',latitude:-22.83,longitude:-43.45,public_number:'2'}],gps:null};
const reader=data=>createCourierMapReader({token:'fixture',fetcher:async(path,opts)=>{assert.equal(path,'/api/v1/courier/map');assert.equal(opts.headers.Authorization,'Bearer fixture');return {ok:true,json:async()=>({data})};}});
test('original geographic route order and GPS freshness',async()=>{
 const x=reader({...base,gps:{latitude:-22.85,longitude:-43.45,accuracy_m:20,observed_at:new Date().toISOString()}});
 const data=await x.read();assert.equal(data.routes.length,1);assert.equal(data.routes[0].stops[0].delivery.id,'a');assert.equal(data.numbers.c,'2');assert.ok(data.gps);
 assert.equal((await reader({...base,gps:{latitude:-22.85,longitude:-43.45,accuracy_m:20,observed_at:'2000-01-01T00:00:00Z'}}).read()).gps,null);
});
test('reject foreign store and terminal delivery; stop clears access',async()=>{
 const x=reader({...base,deliveries:[{...base.deliveries[0],store_id:'other'}]});await assert.rejects(x.read(),/inconsistente/);
 const y=reader({...base,deliveries:[{...base.deliveries[0],status:'entregue'}]});await assert.rejects(y.read(),/inconsistente/);
 y.stop();await assert.rejects(y.read(),/encerrada/);
});
