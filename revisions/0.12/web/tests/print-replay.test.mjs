import test from 'node:test';
import assert from 'node:assert/strict';
import {ingestJobs} from '../printBridge.mjs';
const job={id:'job-a',store_id:'store-a',order_id:'order-a',printer:'Thermal',width:58,receipt:{items:[{name:'Açaí',quantity:1,unit_price:20}],total:20}};
test('existing durable job never re-renders or enqueues; ACK is retried',async()=>{
 const calls=[];
 await ingestJobs({jobs:[job],device:'device',call:async(cmd,args)=>{calls.push([cmd,args]);assert.equal(cmd,'has_saved_print_job');return true},ack:async args=>calls.push(['ack',args])});
 assert.deepEqual(calls,[['has_saved_print_job',{id:'job-a',storeId:'store-a',printer:'Thermal',width:58}],['ack',{p_job:'job-a',p_device:'device',p_state:'saved',p_error:null}]]);
});
test('new job is written before acknowledging; a repeat does not enqueue again',async()=>{
 const calls=[];let saved=false;
 const call=async(cmd,args)=>{calls.push(cmd);if(cmd==='has_saved_print_job')return saved;assert.equal(cmd,'enqueue_job');assert.equal(args.job.id,job.id);saved=true;};
 const ack=async()=>calls.push('ack');
 await ingestJobs({jobs:[job],device:'device',call,ack});
 await ingestJobs({jobs:[{...job,receipt:{...job.receipt,total:25}}],device:'device',call,ack});
 assert.deepEqual(calls,['has_saved_print_job','enqueue_job','ack','has_saved_print_job','ack']);
});
test('concurrent replay with durable winner preserves first saved receipt',async()=>{
 let probes=0,acks=0;
 await ingestJobs({jobs:[job],device:'device',call:async(cmd)=>{if(cmd==='has_saved_print_job')return ++probes===2;throw Error('ID repetido com conteúdo divergente')},ack:async()=>acks++});
 assert.equal(acks,1);
});
test('routing mismatch and failed disk write do not acknowledge',async()=>{
 let acks=0;
 for(const mode of ['route','disk'])await assert.rejects(ingestJobs({jobs:[job],device:'device',call:async(cmd)=>{if(mode==='route')throw Error('ID de impressão com destino divergente');if(cmd==='has_saved_print_job')return false;throw Error('disk full')},ack:async()=>acks++}));
 assert.equal(acks,0);
});
