import test from 'node:test';import assert from 'node:assert/strict';import {orderStage,matchesOrder} from '../orderBoard.mjs';
test('board reflects confirmed backend stages and delivery pickup',()=>{
 assert.equal(orderStage({status:'pending'}),'analysis');assert.equal(orderStage({status:'accepted'}),'preparing');
 assert.equal(orderStage({status:'accepted',preparation_status:'ready'}),'ready');
 assert.equal(orderStage({status:'accepted'},{status:'atribuida'}),'preparing');
 assert.equal(orderStage({status:'accepted'},{status:'retirada'}),'delivery');
 assert.equal(orderStage({status:'accepted'},{status:'entregue'}),'completed');
 assert.equal(orderStage({status:'accepted'},{status:'cancelada'}),'cancelled');
 assert.equal(orderStage({status:'accepted',preparation_status:'completed'}),'completed');
});
test('search handles names phone code and missing receipts',()=>{const o={id:'abc123',receipt:{customer:'Cliente Teste',phone:'11988888888'}};assert.ok(matchesOrder(o,' TESTE '));assert.ok(matchesOrder(o,'9888'));assert.ok(matchesOrder(o,'abc'));assert.equal(matchesOrder({},'teste'),false)});
