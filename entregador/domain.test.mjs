import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateChangeCents, requiresCollection, canAdvanceLocally, canReassign, DELIVERY_STATUS } from './domain.mjs';

test('cash change is exact in cents', () => {
  assert.equal(calculateChangeCents(4290, 5000), 710);
  assert.equal(calculateChangeCents(4290, 4290), 0);
  assert.throws(() => calculateChangeCents(4290, 4000));
  assert.throws(() => calculateChangeCents(42.9, 50));
});
test('paid orders are never flagged for collection', () => {
  assert.equal(requiresCollection({payment_status:'paid'}), false);
  assert.equal(requiresCollection({payment_status:'unpaid'}), true);
  assert.equal(requiresCollection({payment_status:'pending_confirmation'}), true);
  assert.equal(requiresCollection({}), 'unknown');
});
test('driver starts with collect, not accept/reject', () => {
  assert.equal(canAdvanceLocally({status:DELIVERY_STATUS.ASSIGNED,action:'collect'}), true);
  assert.equal(canAdvanceLocally({status:DELIVERY_STATUS.ASSIGNED,action:'accept'}), false);
  assert.equal(canAdvanceLocally({status:DELIVERY_STATUS.ASSIGNED,action:'reject'}), false);
});
test('delivery completion requires both confirmation and paid status', () => {
  assert.equal(canAdvanceLocally({status:DELIVERY_STATUS.OUT_FOR_DELIVERY,action:'complete',codeConfirmed:true,paymentStatus:'paid'}), true);
  assert.equal(canAdvanceLocally({status:DELIVERY_STATUS.OUT_FOR_DELIVERY,action:'complete',codeConfirmed:false,paymentStatus:'paid'}), false);
  assert.equal(canAdvanceLocally({status:DELIVERY_STATUS.OUT_FOR_DELIVERY,action:'complete',codeConfirmed:true,paymentStatus:'unpaid'}), false);
});
test('reassignment after pickup needs merchant permission and reason', () => {
  assert.equal(canReassign({status:DELIVERY_STATUS.ASSIGNED,hasMerchantPermission:true}), true);
  assert.equal(canReassign({status:DELIVERY_STATUS.PICKED_UP,hasMerchantPermission:true}), false);
  assert.equal(canReassign({status:DELIVERY_STATUS.PICKED_UP,hasMerchantPermission:true,reason:'Mudança de rota'}), true);
  assert.equal(canReassign({status:DELIVERY_STATUS.DELIVERED,hasMerchantPermission:true,reason:'Mudança de rota'}), false);
});
