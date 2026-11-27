import test from 'node:test';
import assert from 'node:assert/strict';
import {createMerchantRealtime} from '../clients/merchant-realtime.mjs';
const A='20000000-0000-4000-8000-000000000001', B='20000000-0000-4000-8000-000000000002';
const event=(n,store=A)=>({event:'pitacco.invalidate',channel:'private-pitacco.store.'+store,data:JSON.stringify({resource:'orders',event_id:'30000000-0000-4000-8000-'+String(n).padStart(12,'0')})});
const ok=(n=1)=>({ok:true,status:200,json:async()=>({data:[{id:n}],limit:50,offset:0})});
function setup(fetcher){
  const states=[];
  const adapter=createMerchantRealtime({store:A,token:'fixture-token',onState:s=>states.push(s),fetcher});
  return {adapter,states};
}
test('authorized API snapshot on initial connection and reconnect; reject foreign, malformed and duplicate signals',async()=>{
  let calls=0;
  const {adapter,states}=setup(async(url,opts)=>{
    assert.equal(url,'/api/v1/stores/'+A+'/orders?limit=50&offset=0');
    assert.equal(opts.headers.Authorization,'Bearer fixture-token');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.cache,'no-store');
    return ok(++calls);
  });
  await adapter.connected();
  await adapter.receive(event(1,B));
  await adapter.receive({...event(1),data:'bad'});
  await adapter.receive({...event(1),data:{resource:'orders',event_id:'invalid'}});
  assert.equal(calls,1);
  await adapter.receive(event(1));
  await adapter.receive(event(1));
  assert.equal(calls,2);
  adapter.disconnected();
  assert.equal(states.at(-1).state,'stale');
  await adapter.receive(event(2));
  assert.equal(calls,2);
  await adapter.connected();
  assert.equal(calls,3);
  assert.deepEqual(states.at(-1).data,[{id:3}]);
  adapter.stop();
  await adapter.connected();
  assert.equal(calls,3);
  assert.equal(states.at(-1).data,null);
});
test('coalesce changes during a request, then reread once',async()=>{
  let calls=0,release;
  const {adapter,states}=setup(async()=>{
    calls++;
    if(calls===1)return new Promise(resolve=>{release=resolve;});
    return ok(calls);
  });
  const first=adapter.connected();
  await Promise.resolve();
  const a=adapter.receive(event(1)),b=adapter.receive(event(2));
  release(ok());
  await Promise.all([first,a,b]);
  assert.equal(calls,2);
  assert.deepEqual(states.at(-1).data,[{id:2}]);
});
test('network and rate limit mark stale, revocation clears data and prevents further requests',async()=>{
  let calls=0;
  const {adapter,states}=setup(async()=>{
    calls++;
    if(calls===1)return ok();
    if(calls===2)throw new Error('offline');
    if(calls===3)return {ok:false,status:429};
    return {ok:false,status:403};
  });
  await adapter.connected();
  await adapter.receive(event(1));
  assert.equal(states.at(-1).state,'stale');
  await adapter.refresh();
  assert.equal(states.at(-1).state,'rate_limited');
  await adapter.refresh();
  assert.equal(states.at(-1).state,'unauthorized');
  assert.equal(states.at(-1).data,null);
  await adapter.connected();
  assert.equal(calls,4);
});
test('logout while a fetch is pending never restores data',async()=>{
  let release;
  const {adapter,states}=setup(async()=>new Promise(resolve=>{release=resolve;}));
  const p=adapter.connected();
  await Promise.resolve();
  adapter.stop();
  release(ok());
  await p;
  assert.equal(states.at(-1).state,'stopped');
  assert.equal(states.at(-1).data,null);
});
