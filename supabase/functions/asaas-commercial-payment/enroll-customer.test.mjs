import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollCustomer,validDocument} from './enroll-customer.mjs';
const cpf=(()=>{const n=[1,2,3,4,5,6,7,8,9];for(const size of [9,10]){const d=(n.slice(0,size).reduce((a,v,i)=>a+v*(size+1-i),0)*10)%11;n.push(d===10?0:d)}return n.join('')})();
const storeId='12345678-1234-1234-1234-123456789abc',reference='pitacco:store:'+storeId;
const opts={storeId,name:'Estabelecimento de teste',document:cpf,reservation:'reserved',apiKey:'fake'};
const customer={id:'cus_test',cpfCnpj:cpf,externalReference:reference};
const empty=()=>Response.json({data:[],totalCount:0,hasMore:false});
test('validates checksum and rejects invalid fiscal documents',()=>{
 assert.equal(validDocument(cpf),cpf);assert.equal(validDocument('00000000000'),null);assert.equal(validDocument(cpf.slice(0,-1)+'9'),null);assert.equal(validDocument('abc'),null);
});
test('existing exact reference is reused',async()=>{
 const result=await enrollCustomer({...opts,fetcher:async(url,init)=>{assert.notEqual(init.method,'POST');return Response.json({data:[customer],totalCount:1,hasMore:false})}});
 assert.equal(result.customer_id,'cus_test');
});
test('new customer is created only after both reference and document searches are empty',async()=>{
 let calls=0;
 const result=await enrollCustomer({...opts,fetcher:async(url,init)=>{calls++;if(calls<3)return empty();assert.equal(init.method,'POST');assert.equal(JSON.parse(init.body).notificationDisabled,true);return Response.json(customer)}});
 assert.equal(result.customer_id,'cus_test');assert.equal(calls,3);
});
test('a customer found with the same document but another reference is not adopted',async()=>{
 let calls=0;
 const result=await enrollCustomer({...opts,fetcher:async(url,init)=>{assert.notEqual(init.method,'POST');if(++calls===1)return empty();return Response.json({data:[{...customer,externalReference:'other'}],totalCount:1,hasMore:false})}});
 assert.equal(result.outcome,'review_required');
});
test('uncertain prior enrollment never creates a second customer',async()=>{
 const result=await enrollCustomer({...opts,reservation:'recover_only',fetcher:async(url,init)=>{assert.notEqual(init.method,'POST');return empty()}});
 assert.equal(result.outcome,'review_required');
});
