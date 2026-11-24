import test from 'node:test';
import assert from 'node:assert/strict';
import {issueReservedCharge} from '../issue-commercial-candidate.mjs';
const reservation={outcome:'reserved',invoice_id:'12345678-1234-1234-1234-123456789abc',environment:'production',customer_id:'cus_test',amount_cents:1749,billing_type:'PIX',due_date:'2026-12-01'};
const payment={id:'pay_test',customer:'cus_test',value:17.49,billingType:'PIX',dueDate:reservation.due_date,externalReference:'pitacco:commercial:'+reservation.invoice_id};
const empty=()=>Response.json({data:[],hasMore:false,totalCount:0});
test('only a new reservation can create a charge, with exact reference and amount',async()=>{
 let post=0;
 const result=await issueReservedCharge({reservation,apiKey:'fake',fetcher:async(url,init)=>{
 if(init.method==='POST'){post++;assert.equal(JSON.parse(init.body).value,17.49);assert.equal(JSON.parse(init.body).externalReference,payment.externalReference);return Response.json(payment)}
 assert.equal(url.searchParams.get('externalReference'),payment.externalReference);return empty();
 }});
 assert.equal(post,1);assert.equal(result.payment_id,'pay_test');
});
test('recovery never repeats an uncertain POST even when lookup is empty',async()=>{
 const result=await issueReservedCharge({reservation:{...reservation,outcome:'recover_only'},apiKey:'fake',fetcher:async(url,init)=>{assert.notEqual(init.method,'POST');return empty()}});
 assert.equal(result.outcome,'review_required');
});
test('existing exact charge is linked without a second POST',async()=>{
 const result=await issueReservedCharge({reservation,apiKey:'fake',fetcher:async(url,init)=>{assert.notEqual(init.method,'POST');return Response.json({data:[payment],hasMore:false,totalCount:1})}});
 assert.equal(result.payment_id,'pay_test');
});
test('mismatch or ambiguous external references are never adopted',async()=>{
 for(const data of [[{...payment,value:20}],[payment,payment]]){
 const result=await issueReservedCharge({reservation,apiKey:'fake',fetcher:async(url,init)=>{assert.notEqual(init.method,'POST');return Response.json({data,hasMore:false,totalCount:data.length})}});
 assert.equal(result.outcome,'review_required');
 }
});
test('unknown provider outcome is reviewed without retry',async()=>{
 let calls=0;
 const result=await issueReservedCharge({reservation,apiKey:'fake',fetcher:async()=>{if(++calls===1)return empty();throw Error('timeout')}});
 assert.equal(calls,2);assert.equal(result.outcome,'review_required');
});
