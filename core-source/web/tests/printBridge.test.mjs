import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptText,ingestJobs} from '../printBridge.mjs';
const job={id:'job-1',store_id:'s1',order_id:'o1',width:58,printer:'Thermal',sector:'Cozinha',receipt:{items:[{quantity:2,name:'Açaí',unit_price:20,modifiers:['Leite']}],total:40,delivery_code:'SECRET',raw:{password:'SECRET'},notes:'Teste\x1b@'}};
test('receipt allowlist excludes secrets and raw commands, respects width',()=>{const s=receiptText(job);assert(!s.includes('SECRET'));assert(!s.includes('\x1b'));assert(s.includes('2 x Açaí'));assert(s.split('\n').every(x=>x.length<=32));});
test('acknowledges only after durable enqueue',async()=>{const steps=[];await ingestJobs({jobs:[job],device:'d',call:async(cmd)=>{steps.push(cmd);return false},ack:async()=>steps.push('ack')});assert.deepEqual(steps,['has_saved_print_job','enqueue_job','ack']);});
test('native persistence failure does not acknowledge',async()=>{let ack=false;await assert.rejects(()=>ingestJobs({jobs:[job],device:'d',call:async()=>{throw Error('disk full')},ack:async()=>{ack=true}}));assert.equal(ack,false);});
test('redelivery retains stable server job id',async()=>{const ids=[];for(let i=0;i<2;i++)await ingestJobs({jobs:[job],device:'d',call:async(cmd,args)=>{if(cmd==='enqueue_job')ids.push(args.job.id);return false},ack:async()=>{}});assert.deepEqual(ids,['job-1','job-1']);});
