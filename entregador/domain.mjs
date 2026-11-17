// Pure business rules shared by the Pitacco Entregador web client.
// All final authorization and financial confirmation MUST be enforced by backend.
export const DELIVERY_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  PICKED_UP: 'picked_up',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
});
export function calculateChangeCents(totalCents, tenderedCents) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('Invalid order total');
  if (!Number.isSafeInteger(tenderedCents) || tenderedCents < totalCents) throw new Error('Insufficient cash tendered');
  return tenderedCents - totalCents;
}
export function requiresCollection(order) {
  if (!order || !['paid', 'unpaid', 'pending_confirmation'].includes(order.payment_status)) {
    return 'unknown';
  }
  return order.payment_status === 'paid' ? false : true;
}
export function canAdvanceLocally({ status, action, paymentStatus, codeConfirmed }) {
  // UI gating only. Backend must verify ownership, current assignment version,
  // marketplace confirmation and actual payment status.
  if (status === DELIVERY_STATUS.ASSIGNED && action === 'collect') return true;
  if (status === DELIVERY_STATUS.PICKED_UP && action === 'depart') return true;
  if (status === DELIVERY_STATUS.OUT_FOR_DELIVERY && action === 'complete') {
    return codeConfirmed === true && paymentStatus === 'paid';
  }
  return false;
}
export function canReassign({ status, hasMerchantPermission, reason }) {
  if (!hasMerchantPermission || status === DELIVERY_STATUS.DELIVERED) return false;
  if (status === DELIVERY_STATUS.ASSIGNED) return true;
  return typeof reason === 'string' && reason.trim().length >= 5;
}
