import test from 'node:test';import assert from 'node:assert/strict';
import {optimizeRoadTrip} from '../roadOptimizer.mjs';
const orders=[{id:'a',status:'pendente'},{id:'b',status:'pendente'},{id:'c',status:'pendente',logistics_provider:'marketplace'}];
const matrix=[[0,300,320,100],[300,0,1000,100],[320,1000,0,100],[100,100,100,0]];
test('single order is allowed',()=>assert.equal(optimizeRoadTrip({orders,matrix,maxOrders:1}).selected.length,1));
test('opposite directions are not grouped',()=>assert.equal(optimizeRoadTrip({orders,matrix,maxOrders:2}).selected.length,1));
test('marketplace partner never enters trip',()=>assert.ok(!optimizeRoadTrip({orders,matrix,maxOrders:3}).selected.some(x=>x.id==='c')));
test('invalid matrix fails closed',()=>assert.throws(()=>optimizeRoadTrip({orders,matrix:[],maxOrders:2})));
test('same-direction trip groups',()=>{const m=[[0,300,400],[300,0,90],[400,90,0]];assert.equal(optimizeRoadTrip({orders:orders.slice(0,2),matrix:m,maxOrders:2,maxDetourRatio:1.5}).selected.length,2)});
