import test from 'node:test';
import assert from 'node:assert/strict';
import {orderProfit,summarizeChannels} from '../orderProfit.mjs';
const order={customer_paid:30,merchant_discount:3,platform_fees:2,processing_fees:1,delivery_cost:5,goods_cost:8,other_cost:1};
test('computes profit and margin in BRL',()=>{const x=orderProfit(order);assert.equal(x.profit,10);assert.equal(x.margin,33.33)});
test('unknown goods cost is not interpreted as zero',()=>{const x=orderProfit({...order,goods_cost:null});assert.equal(x.complete,false);assert.equal(x.profit,null);assert(x.missing.includes('goods'))});
test('known zero is accepted',()=>assert.equal(orderProfit({...order,other_cost:0}).profit,11));
test('negative costs are rejected',()=>assert.throws(()=>orderProfit({...order,delivery_cost:-2})));
test('channel comparisons flag incomplete data',()=>{const x=summarizeChannels([{...order,channel:'ifood'},{...order,channel:'99food',goods_cost:null}]);assert.equal(x.find(v=>v.channel==='ifood').profit,10);assert.equal(x.find(v=>v.channel==='99food').profit,null)});
