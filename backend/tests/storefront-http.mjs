// CI only. Exercises actual Laravel and reconstructed PostgreSQL, never production.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readCoreMenu,placeCoreOrder,recoverCoreOrder} from '../clients/storefront.mjs';
const fetcher=(path,opt)=>fetch('http://127.0.0.1:8081'+path,opt);
const slug='core-checkout-fixture';
const menu=await readCoreMenu(slug,{fetcher});
assert.equal(menu.state,'ready');
assert.equal(menu.data.store.slug,slug);
const cart={request_id:randomUUID(),customer:'Cliente HTTP Fixture',phone:'21988883333',items:[{product_id:'91000000-0000-0000-0000-000000000003',quantity:1,options:[]}],fulfillment:'pickup',payment:'pix_manual'};
// Simulate a lost HTTP response after the actual server has completed the checkout.
let calls=0;
const lost=await placeCoreOrder(slug,cart,{fetcher:async(path,opt)=>{
  calls++;
  const response=await fetcher(path,opt);
  assert.equal(response.status,200);
  await response.text();
  throw Error('synthetic lost response');
}});
assert.equal(calls,1);assert.equal(lost.state,'uncertain');
const recovered=await recoverCoreOrder(slug,cart.request_id,{fetcher});
assert.equal(recovered.state,'confirmed');assert.equal(Number(recovered.data.total),25);
const replay=await placeCoreOrder(slug,cart,{fetcher});
assert.equal(replay.state,'confirmed');assert.equal(replay.data.order_id,recovered.data.order_id);
console.log('PASS: actual Laravel storefront transport, lost confirmation, same-request recovery and replay');
