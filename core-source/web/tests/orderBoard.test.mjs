import test from 'node:test';import assert from 'node:assert/strict';import {orderStage,matchesOrder} from '../orderBoard.mjs';
test('board reflects confirmed backend stages and delivery pickup',()=>{
 assert.equal(orderStage({status:'pending'}),'analysis');assert.equal(orderStage({status:'accepted'}),'preparing');
 assert.equal(orderStage({status:'accepted',preparation_status:'ready'}),'ready');
 assert.equal(orderStage({status:'accepted'},{status:'atribuida'}),'preparing');
 assert.equal(orderStage({status:'accepted'},{status:'retirada'}),'delivery');
 assert.equal(orderStage({status:'accepted'},{status:'entregue'}),'completed');
 assert.equal(orderStage({status:'accepted'},{status:'cancelada'}),'cancelled');
 assert.equal(orderStage({status:'accepted',preparation_status:'completed'}),'ready');
});
test('search handles names phone code and missing receipts',()=>{const o={id:'abc123',receipt:{customer:'Cliente Teste',phone:'11988888888'}};assert.ok(matchesOrder(o,' TESTE '));assert.ok(matchesOrder(o,'9888'));assert.ok(matchesOrder(o,'abc'));assert.equal(matchesOrder({},'teste'),false)});

test('scheduled pending stays in analysis, accepted waits until preparation release',()=>{const future=new Date(Date.now()+3600000).toISOString();assert.equal(orderStage({status:'pending',scheduled_for:future,scheduled_release_at:future}),'analysis');assert.equal(orderStage({status:'accepted',scheduled_for:future,scheduled_release_at:future,preparation_status:'preparing'}),'analysis');assert.equal(orderStage({status:'accepted',scheduled_for:future,scheduled_release_at:new Date(Date.now()-1000).toISOString(),preparation_status:'preparing'}),'preparing');});


test('iFood ready never marks a delivery completed',()=>{
 const order={source:'ifood',status:'accepted',preparation_status:'ready',receipt:{ifood_status:'READY_TO_PICKUP'}};
 assert.equal(orderStage(order,{status:'pendente'}),'ready');
 assert.equal(orderStage({...order,preparation_status:'completed'},{status:'pendente'}),'ready');
 assert.equal(orderStage(order,{status:'retirada'}),'delivery');
 assert.equal(orderStage(order,{status:'entregue'}),'completed');
});

test('own pickup completion ends the order after customer collects',()=>{
 const order={source:'proprio',status:'accepted',preparation_status:'completed',receipt:{logistics:'retirada'}};
 assert.equal(orderStage(order,null),'completed');
});

test('independent iFood CONCLUDED is distinct from a still active courier route',()=>{
 const order={source:'ifood',status:'accepted',preparation_status:'ready',receipt:{ifood_status:'CONCLUDED'}};
 assert.equal(orderStage(order,{status:'pendente'}),'completed');
 assert.equal(orderStage(order,{status:'retirada'}),'delivery');
});
