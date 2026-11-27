import test from 'node:test';
import assert from 'node:assert/strict';
import {createIfoodActions} from '../clients/ifood-actions.mjs';
const store='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001',id='30000000-0000-4000-8000-000000000004';
const order={id,store_id:store,source:'ifood',status:'pending',receipt:{}};
function setup(){
 let identity=actor,result={data:{status:'requested'}};
 const calls=[];
 const bridge=createIfoodActions({store,actor,legacyClient:{auth:{getUser:async()=>({data:{user:{id:identity}}})},functions:{invoke:async(name,opts)=>{calls.push({name,opts});if(result instanceof Error)throw result;return result;}}}});
 return {bridge,calls,identity:v=>identity=v,result:v=>result=v};
}
test('unchanged original function, asynchronous confirmation, no local order mutation',async()=>{
 const x=setup(),o=structuredClone(order);
 assert.deepEqual(await x.bridge.accept(o),{state:'awaiting_official_event',action:'accept'});
 assert.deepEqual(o,order);
 assert.deepEqual(x.calls,[{name:'ifood-manual-action',opts:{body:{action:'accept',order_id:id}}}]);
 await assert.rejects(x.bridge.accept(o),/reconciliação/);
});
test('dynamic reasons and explicit cancel only; already requested remains pending',async()=>{
 const x=setup();
 await assert.rejects(x.bridge.cancel(order,'501'),/motivo oficial/);
 x.result({data:{reasons:[{code:'501',description:'Motivo fictício'}]}});
 assert.deepEqual(await x.bridge.reasons(order),{reasons:[{code:'501',description:'Motivo fictício'}]});
 await assert.rejects(x.bridge.cancel(order,'502'),/motivo oficial/);
 x.result({data:{status:'already_requested'}});
 assert.deepEqual(await x.bridge.cancel(order,'501'),{state:'awaiting_official_event',action:'cancel'});
 assert.equal(x.calls.length,2);assert.equal(x.calls[1].opts.body.reason,'501');
});
test('foreign store, own order, official pending marker, wrong identity and logout are denied',async()=>{
 const x=setup();
 for(const o of [{...order,store_id:actor},{...order,source:'proprio'},{...order,status:'accepted'},{...order,receipt:{ifood_manual_cancel:'requested'}}])await assert.rejects(x.bridge.accept(o));
 x.identity(store);await assert.rejects(x.bridge.accept(order),/não corresponde/);
 assert.equal(x.calls.length,0);x.bridge.stop();await assert.rejects(x.bridge.accept(order),/encerrada/);
});
test('network uncertainty blocks repeated accept and cancel; concurrent action denied',async()=>{
 const x=setup();x.result(Error('network'));
 const p=x.bridge.accept(order);
 await assert.rejects(x.bridge.accept(order),/andamento/);
 assert.deepEqual(await p,{state:'uncertain',action:'accept'});
 await assert.rejects(x.bridge.accept(order),/reconciliação/);
 await assert.rejects(x.bridge.reasons(order),/reconciliação/);
 assert.equal(x.calls.length,1);
});
