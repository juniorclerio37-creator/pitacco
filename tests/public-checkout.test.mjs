// Lightweight contract tests for public checkout markup. Run: node --test tests/public-checkout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
test('checkout uses a stable idempotency request key and backend RPC',()=>{
 assert.match(html,/p_request:routeMode\?deliveryQuote\.requestId:crypto\.randomUUID\(\)/);
 assert.match(html,/if\(!pendingRequest\)/);
 assert.match(html,/pitacco_checkout_geocoded_order/);
 assert.match(html,/client\.rpc\(endpoint,pendingRequest\)/);
});
test('checkout blocks concurrent submissions even if cart rerenders',()=>{
 assert.match(html,/if\(submitting\|\|!cart\.length\)return/);
 assert.match(html,/submitting=true/);
 assert.match(html,/disabled=\(!storeOpening\?\.open&&!pendingRequest\)\|\|submitting\|\|!cart\.length/);
 assert.match(html,/lockCheckout\(Boolean\(pendingRequest\)\)/);
});
test('checkout validates address, phone, and payment',()=>{
 assert.match(html,/phoneDigits\.length<10\|\|phoneDigits\.length>11/);
 assert.match(html,/fulfillment==='delivery'&&\$\('address'\)\.value\.trim\(\)\.length<10/);
 assert.match(html,/!fulfillment\|\|!payment/);
});
test('cart supports multiple variants and quantity editing',()=>{
 assert.doesNotMatch(html,/cart\.some\(c=>c\.product_id===p\.id\)/);
 assert.match(html,/qtyInput\.addEventListener\('change'/);
 assert.match(html,/item\.quantity=n;renderCart\(\)/);
});
test('manual pix stays pending based on backend confirmation',()=>{
 assert.match(html,/data\.payment_status==='paid_manual'/);
 assert.match(html,/pix_manual:'Pix manual/);
});

test('distance pricing requires a server quote and exact delivery fee',()=>{
 assert.match(html,/pitacco_checkout_quoted_delivery/);
 assert.match(html,/client\.functions\.invoke\('delivery-quote'/);
 assert.match(html,/deliveryQuote\.fee/);
 assert.match(html,/Calcule a taxa de entrega/);
});

test('store opening hours block new orders in the browser and require server verification',()=>{
 assert.match(html,/client\.rpc\('pitacco_public_store_open'/);
 assert.match(html,/storeOpenStatus/);
 assert.match(html,/refreshStoreOpening\(\)/);
 assert.match(html,/!storeOpening\?\.open/);
 assert.match(html,/Loja fechada/);
});
