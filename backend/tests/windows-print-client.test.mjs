import test from 'node:test';
import assert from 'node:assert/strict';
import {createWindowsPrintClient} from '../clients/windows-print.mjs';
import {ingestJobs} from '../../core-source/web/printBridge.mjs';
const store='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002',device='30000000-0000-4000-8000-000000000001';
const id=n=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0');
const job=(n,state='claimed')=>({id:id(n),store_id:store,order_id:id(99),state,printer:'FIXTURE',width:58,receipt:{source:'proprio',display_number:'D-101',customer:'Cliente Fixture',items:[{name:'Açaí',quantity:1,modifiers:[{name:'Leite em pó',quantity:2}]}],total:20,payment:'dinheiro'}});
function setup(jobs){
 const saved=new Map(),acks=[],calls=[],local=[];let deny=false,failAck=false,failFinal=false;
 const bridge=createWindowsPrintClient({store,device,token:'fixture-only',ingestJobs,
 nativeCall:async(op,args)=>{calls.push(op);if(op==='list_jobs')return local;if(op==='has_saved_print_job')return saved.has(args.id);if(op==='enqueue_job'){assert.ok(!saved.has(args.job.id));saved.set(args.job.id,args.job.receipt);return;}throw Error(op);},
 fetcher:async(path,opts)=>{assert.ok(path.startsWith('/api/v1/stores/'+store+'/own-print/'));assert.equal(opts.headers.Authorization,'Bearer fixture-only');assert.equal(opts.redirect,'error');const data=JSON.parse(opts.body);assert.equal(data.device_id,device);
 if(deny)return {ok:false,status:404};
 if(path.endsWith('/bind'))return {ok:true,json:async()=>({data:{bound:true}})};
 if(path.endsWith('/claim'))return {ok:true,json:async()=>({data:{jobs}})};
 if(failAck||(failFinal&&data.state!=='saved'))return {ok:false,status:503};
 acks.push(data);return {ok:true,json:async()=>({data:{acknowledged:true}})};}});
 return {bridge,saved,acks,calls,local,deny:()=>{deny=true;},fail:v=>{failAck=v;},failFinal:v=>{failFinal=v;}};
}
test('original Windows ingest, same UUID after lost ACK, no duplicate durable receipt',async()=>{
 const x=setup([job(1)]);await x.bridge.bind();x.fail(true);await assert.rejects(x.bridge.sync(),/Fila indisponível/);
 assert.equal(x.saved.size,1);assert.match(x.saved.get(id(1)),/D-101/);assert.match(x.saved.get(id(1)),/COBRAR NA ENTREGA/);
 x.fail(false);await x.bridge.sync();assert.equal(x.saved.size,1);assert.equal(x.calls.filter(v=>v==='enqueue_job').length,1);assert.equal(x.acks[0].job_id,id(1));
});
test('uncertain, error and missing saved jobs never recreated; reject foreign batch before enqueue',async()=>{
 const x=setup([job(1,'uncertain'),job(2,'saved'),job(3,'error')]);assert.deepEqual(await x.bridge.sync(),{eligible:0,manual:[id(1),id(2),id(3)]});assert.equal(x.saved.size,0);
 const y=setup([job(1),{...job(2),store_id:other}]);await assert.rejects(y.bridge.sync(),/Lote/);assert.equal(y.saved.size,0);
});
test('revocation stops further requests and local ingestion',async()=>{
 const x=setup([job(1)]);x.deny();await assert.rejects(x.bridge.sync(),/não autorizada/);await assert.rejects(x.bridge.sync(),/encerrada/);assert.equal(x.saved.size,0);
});

test('reconcile only claimed native jobs, retry lost final ACK without resending to spooler',async()=>{
 const x=setup([job(1),job(2,'uncertain')]);
 x.saved.set(id(1),'already printed');x.saved.set(id(2),'uncertain local');
 x.local.push({id:id(1),store_id:store,state:'submitted'},{id:id(2),store_id:store,state:'uncertain',error:'private-path'},
 {id:id(3),store_id:store,state:'submitted'},{id:id(1),store_id:other,state:'submitted'});
 x.failFinal(true);
 const first=await x.bridge.syncAndReconcile();
 assert.deepEqual(first.pending,[id(1),id(2)]);assert.equal(first.local.length,2);
 x.failFinal(false);assert.deepEqual((await x.bridge.syncAndReconcile()).pending,[]);
 const terminal=x.acks.filter(a=>a.state!=='saved');
 assert.deepEqual(terminal.map(a=>[a.job_id,a.state]),[[id(1),'submitted'],[id(2),'uncertain']]);
 assert.ok(!JSON.stringify(terminal).includes('private-path'));
 await x.bridge.syncAndReconcile();
 assert.equal(x.acks.filter(a=>a.state!=='saved').length,2);
 assert.equal(x.calls.filter(a=>a==='enqueue_job').length,0);
});
test('duplicate local identities fail closed and concurrent polls share one cycle',async()=>{
 const x=setup([job(1)]);x.local.push({id:id(1),store_id:store,state:'submitted'},{id:id(1),store_id:store,state:'error'});
 const a=x.bridge.syncAndReconcile(),b=x.bridge.syncAndReconcile();assert.equal(a,b);
 await assert.rejects(a,/inconsistente/);
 assert.equal(x.acks.filter(a=>a.state!=='saved').length,0);
});
