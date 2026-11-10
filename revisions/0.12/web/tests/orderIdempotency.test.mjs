import test from 'node:test';
import assert from 'node:assert/strict';
import {idempotencyKey,marketplaceIdentity,shouldAutoPrint} from '../orderIdempotency.mjs';
test('same marketplace order and event produce same key',()=>{const x={storeId:'loja1',source:'ifood',externalOrderId:'123',eventType:'accepted'};assert.equal(idempotencyKey(x),idempotencyKey({...x,source:'IFOOD'}))});
test('different stores and sources are independent',()=>{const x={storeId:'loja1',source:'ifood',externalOrderId:'123',eventType:'accepted'};assert.notEqual(idempotencyKey(x),idempotencyKey({...x,storeId:'loja2'}));assert.notEqual(idempotencyKey(x),idempotencyKey({...x,source:'99food'}))});
test('reject missing external ids',()=>assert.throws(()=>marketplaceIdentity({storeId:'loja1',source:'ifood'})));
test('only accepted unprinted jobs auto print',()=>{assert(shouldAutoPrint({status:'accepted',alreadySubmitted:false}));assert(!shouldAutoPrint({status:'accepted',alreadySubmitted:true}));assert(!shouldAutoPrint({status:'pending',alreadySubmitted:false}));assert(shouldAutoPrint({status:'accepted',alreadySubmitted:true,manualReprint:true}))});
