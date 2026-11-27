import test from 'node:test';
import assert from 'node:assert/strict';
import {createMerchantReverb} from '../clients/merchant-reverb.mjs';
const store='20000000-0000-4000-8000-000000000001',channel='private-pitacco.store.'+store;
const key='fixture-key',signature=key+':'+ 'a'.repeat(64);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const sockets=[],states=[],timers=new Map(),calls=[];let next=0,denied=false;
  const adapter=createMerchantReverb({store,token:'fixture-token',key,origin:'http://127.0.0.1:8092',testLoopback:true,
    onState:s=>states.push(s),schedule:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},cancel:id=>timers.delete(id),
    socketFactory:url=>{const s={url,sent:[],closed:false,send(x){this.sent.push(JSON.parse(x));},close(){this.closed=true;},emit(event,data,chan){this.onmessage({data:JSON.stringify({event,data,channel:chan})});}};sockets.push(s);return s;},
    fetcher:async(path,opts)=>{calls.push({path,opts});return path.endsWith('/auth')?
      {status:denied?404:200,ok:!denied,json:async()=>({auth:signature})}:
      {status:200,ok:true,json:async()=>({data:[{id:1}],limit:50,offset:0})};}});
  return {adapter,sockets,states,timers,calls,deny:()=>{denied=true;},run(ms){const entry=[...timers].find(([,x])=>x.ms===ms);assert.ok(entry);timers.delete(entry[0]);entry[1].fn();}};
}
async function subscribe(ws,sid='123.456'){
  ws.emit('pusher:connection_established',JSON.stringify({socket_id:sid}));
  await flush();
  assert.deepEqual(ws.sent.at(-1),{event:'pusher:subscribe',data:{channel,auth:signature}});
  ws.emit('pusher_internal:subscription_succeeded',{},channel);
  await flush();
}
test('handshake, bearer only in API, reconnect with fresh signature, snapshot and stop',async()=>{
  const x=setup();x.adapter.start();const w=x.sockets[0];
  assert.equal(w.url,'ws://127.0.0.1:8092/app/fixture-key?protocol=7&client=js&version=8.4.0');
  await subscribe(w);assert.equal(x.calls[0].opts.headers.Authorization,'Bearer fixture-token');
  assert.equal(x.calls[0].path,'/api/v1/realtime/auth');
  assert.equal(x.states.at(-1).state,'ready');
  w.emit('pusher:ping',{});assert.equal(w.sent.at(-1).event,'pusher:pong');
  w.onclose();assert.equal(x.states.at(-1).state,'stale');x.run(1000);
  await subscribe(x.sockets[1],'123.457');assert.equal(JSON.parse(x.calls[2].opts.body).socket_id,'123.457');
  assert.equal(x.states.at(-1).state,'ready');
  x.adapter.stop();assert.equal(x.timers.size,0);assert.equal(x.sockets[1].closed,true);
  assert.equal(x.states.at(-1).data,null);
});
test('denied channel stops and clears rather than reconnecting',async()=>{
  const x=setup();x.deny();x.adapter.start();x.sockets[0].emit('pusher:connection_established',{socket_id:'1.2'});
  await flush();assert.equal(x.states.at(-1).state,'unauthorized');assert.equal(x.timers.size,0);
  assert.equal(x.sockets[0].sent.length,0);assert.equal(x.sockets[0].closed,true);
});
test('handshake timeout closes and retries; insecure non-loopback origin rejected',()=>{
  const x=setup();x.adapter.start();x.run(12000);assert.equal(x.sockets[0].closed,true);
  x.run(1000);assert.equal(x.sockets.length,2);x.adapter.stop();
  assert.throws(()=>createMerchantReverb({key,origin:'http://example.test'}),/Origem insegura/);
});
