import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadDelivery } from './access-rules.mjs';

const memberships = [
  { user_id: 'manager-a', store_id: 'store-a', role: 'gestor' },
  { user_id: 'driver-a', store_id: 'store-a', role: 'entregador' },
  { user_id: 'manager-b', store_id: 'store-b', role: 'gestor' },
];
const couriers = [
  { id: 'courier-a', user_id: 'driver-a', store_id: 'store-a', active: true },
  { id: 'courier-b', user_id: 'driver-b', store_id: 'store-a', active: true },
  { id: 'courier-c', user_id: 'driver-c', store_id: 'store-b', active: false },
];
const delivery = { store_id: 'store-a', courier_id: 'courier-a' };
const check = (viewerUserId, d=delivery, isPlatformAdmin=false) =>
  canReadDelivery({ memberships, couriers, viewerUserId, delivery:d, isPlatformAdmin });

test('assigned driver sees own delivery', () => assert.equal(check('driver-a'), true));
test('driver cannot see another courier delivery in same store', () => assert.equal(check('driver-a', {store_id:'store-a',courier_id:'courier-b'}), false));
test('store membership alone does not grant driver access', () => assert.equal(check('driver-a', {store_id:'store-a',courier_id:null}), false));
test('manager sees own store delivery', () => assert.equal(check('manager-a'), true));
test('manager cannot see another store delivery', () => assert.equal(check('manager-b'), false));
test('inactive courier cannot see delivery', () => assert.equal(check('driver-c', {store_id:'store-b',courier_id:'courier-c'}), false));
test('cross-store courier ID mismatch is denied', () => assert.equal(check('driver-a', {store_id:'store-b',courier_id:'courier-a'}), false));
test('platform admin sees all deliveries', () => assert.equal(check('admin',delivery,true), true));
