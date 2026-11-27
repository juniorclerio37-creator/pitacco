import test from 'node:test';
import assert from 'node:assert/strict';
import {createWindowsDevice} from '../clients/windows-device.mjs';
const store='20000000-0000-4000-8000-000000000001',device='30000000-0000-4000-8000-000000000001',other='30000000-0000-4000-8000-000000000002';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(initial=null){
 let bound=initial,denied=false,fail=false,stops=0,syncs=0,next=0;
 const requests=[],states=[],timers=new Map();
 const bridge=createWindowsDevice({store,device,token:'fixture',onState:s=>states.push(s),
 printClient:{stop(){stops++;},async syncAndReconcile(){syncs++;return {pending:[]};}},
 schedule:(fn,ms)=>{assert.equal(ms,30000);timers.set(++next,fn);return next;},cancel:id=>timers.delete(id),
 fetcher:async(path,opts)=>{const op=path.split('/').at(-1),data=JSON.parse(opts.body);
 assert.equal(path,'/api/v1/stores/'+store+'/print-device/'+op);assert.equal(opts.headers.Authorization,'Bearer fixture');assert.equal(opts.redirect,'error');
 requests.push({op,data});
 if(denied)return {status:404,ok:false};
 if(fail)return {status:503,ok:false};
 let result;
 if(op==='status')result={status:'connected',bound_device_id:bound,printer_computer_bound:bound!==null,bound_computer_connected:bound===device};
 else if(op==='ping')result={received:true};
 else{if(data.expected_device_id!==bound)return {ok:false,status:409};bound=op==='switch'?device:null;result=op==='switch'?{bound:true}:{unbound:true};}
 return {ok:true,status:200,json:async()=>({data:result})};
 }});
 return {bridge,requests,states,timers,stats:()=>({syncs,stops}),external:v=>{bound=v;},deny:()=>{denied=true;},fail:v=>{fail=v;},
 tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('never claims another device queue, explicit transfer and unbind with current expected id',async()=>{
 const x=setup(other);
 await x.bridge.refresh();
 await assert.rejects(x.bridge.sync(),/não está vinculado/);
 assert.equal(x.stats().syncs,0);
 await x.bridge.switchDevice(other);
 await x.bridge.sync();
 assert.equal(x.stats().syncs,1);
 await x.bridge.unbind(device);
 await assert.rejects(x.bridge.sync(),/não está vinculado/);
 assert.deepEqual(x.requests.filter(r=>['switch','unbind'].includes(r.op)).map(r=>r.data),[
 {device_id:device,expected_device_id:other},{device_id:device,expected_device_id:device}]);
});
test('stale binding conflict requires fresh status, never automatically retries transfer',async()=>{
 const x=setup(other);await x.bridge.refresh();x.external(null);
 await assert.rejects(x.bridge.switchDevice(other),/Vínculo mudou/);
 await assert.rejects(x.bridge.switchDevice(other),/Atualize/);
 assert.equal(x.requests.filter(r=>r.op==='switch').length,1);
 await x.bridge.refresh();await x.bridge.switchDevice(null);
 assert.equal(x.states.at(-1).state,'bound');
});
test('heartbeat recovers network failure without binding automatically and stops on revoked session',async()=>{
 const x=setup(device);x.bridge.start();await flush();
 assert.equal(x.stats().syncs,1);assert.equal(x.timers.size,1);
 x.fail(true);x.tick();await flush();assert.equal(x.states.at(-1).state,'stale');
 x.fail(false);x.tick();await flush();assert.equal(x.stats().syncs,2);
 x.deny();x.tick();await flush();assert.equal(x.states.at(-1).state,'unauthorized');
 assert.equal(x.stats().stops,1);assert.equal(x.timers.size,0);assert.equal(x.requests.filter(r=>r.op==='switch').length,0);
});
