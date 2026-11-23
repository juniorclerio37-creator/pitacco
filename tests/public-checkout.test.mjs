// Lightweight contract tests for public checkout markup. Run: node --test tests/public-checkout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
test('checkout uses a stable idempotency request key and backend RPC',()=>{
 assert.match(html,/p_request:routeMode\?deliveryQuote\.requestId:crypto\.randomUUID\(\)/);
 assert.match(html,/if\(!pendingRequest\)/);
 assert.match(html,/pitacco_checkout_geocoded_order/);
 assert.match(html,/client\.rpc\(endpoint,payload\)/);
 assert.match(html,/p_payment==='fiado'\?'pitacco_checkout_fiado'/);
});
test('checkout blocks concurrent submissions even if cart rerenders',()=>{
 assert.match(html,/if\(submitting\|\|cartRecoveryId\|\|!cart\.length\)return/);
 assert.match(html,/submitting=true/);
 assert.match(html,/disabled=Boolean\(cartRecoveryId\)\|\|\(!storeOpening\?\.open&&!pendingRequest\)\|\|submitting\|\|!cart\.length/);
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
 assert.match(html,/v2ScheduleDeliveryQuote/);
 assert.match(html,/Taxa de entrega:/);
 assert.match(html,/#quoteDelivery\{display:none!important\}/);
 assert.match(html,/Não atendemos essa região/);
});

test('store opening hours block new orders in the browser and require server verification',()=>{
 assert.match(html,/client\.rpc\('pitacco_public_store_open'/);
 assert.match(html,/storeOpenStatus/);
 assert.match(html,/refreshStoreOpening\(\)/);
 assert.match(html,/!storeOpening\?\.open/);
 assert.match(html,/Loja fechada/);
});

test('menu uses saved category icons and custom pizza SVG in every template',()=>{
 assert.match(html,/menu\?\.store\?\.category_icons\?\.\[name\]/);
 assert.match(html,/function pitaccoPizzaSlice\(\)/);
 assert.match(html,/pitaccoSvgNode\('path',\{d:'M7 14 Q32 1 57 14 L32 58 Z'/);
 assert.match(html,/combo-meal/);
 assert.match(html,/combo-burger/);
 assert.match(html,/combo-ice-cream/);
 assert.match(html,/\['🍦','🍨'\]/);
 assert.match(html,/create\(null,'Destaques','flame'\)/);
 assert.match(html,/pitacco-flame-animated/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(html,/const tab=button\('','chip'\)/);
});

test('V2 principal integra banner ao cabeçalho e recupera carrinho sem aviso na home',()=>{
 assert.match(html,/id="storeBanner"/);
 assert.match(html,/\.hero>img#storeBanner\{\s*opacity:1;object-fit:cover/);
 assert.match(html,/\.hero>img#storeBanner\[hidden\]\{\s*display:none!important/);
 assert.match(html,/\.hero:has\(> #storeBanner:not\(\[hidden\]\)\)::after\{[\s\S]*?linear-gradient/);
 assert.match(html,/#v2HeroImage\{\s*display:none!important/);
 assert.doesNotMatch(html,/id="v2BrandBanner"/);
 assert.doesNotMatch(html,/showV2BrandBanner/);
 assert.match(html,/studioPreviewSetImage\('storeBanner',visibleCover\)/);
 assert.match(html,/cartRestoreWarning/);
 assert.match(html,/if\(cartRestoreWarning\)root\.append/);
 assert.doesNotMatch(html,/Sua sacola foi recuperada\. Confira os preços e calcule o frete novamente\./);
 // A sacola continua persistente sem guardar dados de pagamento ou endereço.
 assert.match(html,/localStorage\.setItem\(cartStorageKey/);
 assert.match(html,/const restored=reconcileCartDraft\(draft\.items,menu\.products\)/);
});
