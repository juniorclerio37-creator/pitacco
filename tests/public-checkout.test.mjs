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
 assert.match(html,/if\(submitting\|\|checkoutPreparing\|\|cartRecoveryId\|\|!cart\.length\)return/);
 assert.match(html,/submitting=true/);
 assert.match(html,/disabled=Boolean\(cartRecoveryId\)\|\|\(!timingValid\(\)&&!pendingRequest\)\|\|submitting\|\|!cart\.length/);
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
 assert.match(html,/schedulingAvailable/);
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

test('primeira exibição estável: Fideliza+ e destaques antes do cardápio visível',()=>{
 assert.match(html,/id="menuStartup"/);
 assert.match(html,/MENU_STARTUP_RPC_LIMIT_MS=3400/);
 assert.match(html,/Promise\.all\(\[\s*menuStartupRpc\('pitacco_loyalty_program'/);
 assert.match(html,/menuStartupRpc\('pitacco_public_top_sellers'/);
 assert.match(html,/menuStartupRpc\('pitacco_public_store_region'/);
 assert.match(html,/const \[prepared\]=await Promise\.all\(\[prepareMenuStartup\(\),warmMenuStartupImages\(\)\]\)/);
 assert.match(html,/applyMenuStartupData\(prepared\)/);
 assert.match(html,/await waitForMenuIdentityPaint\(\)/);
 assert.match(html,/initOptions\(\);\s*await waitForMenuIdentityPaint\(\)/);
 assert.match(html,/\$\('menuStartup'\)\.hidden=true/);
 assert.doesNotMatch(html,/renderCategories\(\);renderProducts\(\);void loadLoyalty\(\)/);
 assert.match(html,/cartRestoreWarning/);
});

test('piloto fotográfico da loja teste não altera outros templates e evita cortes',()=>{
 assert.match(html,/if\(slug==='acai-do-linho-demo'\)document\.body\.dataset\.menuPhotoPilot='brendi-linho'/);
 assert.match(html,/body\[data-menu-photo-pilot="brendi-linho"\]\[data-menu-template="pitacco-v2"\]\[data-menu-skin="principal"\]/);
 assert.match(html,/\.category-grid \.product-visual\{\s*width:100%;height:clamp\(176px,21vw,270px\)/);
 assert.match(html,/height:auto;aspect-ratio:1 \/ 1/);
 assert.match(html,/object-fit:contain;object-position:center;box-sizing:border-box/);
 assert.match(html,/img\[data-photo-fit="cover"\]\{\s*object-fit:cover;padding:0/);
 assert.match(html,/\.product-intro>img\{\s*display:block;width:100%;height:min\(72vw,350px\)/);
 assert.match(html,/const ratio=photo\.naturalWidth\/Math\.max\(1,photo\.naturalHeight\)/);
 assert.match(html,/setProductPhotoFit\(img\);img\.src=product\.image_url/);
 assert.match(html,/setProductPhotoFit\(photo\);\s*photo\.src=url/);
});

test('address interface has optional map, automatic freight and shared CEP lookup',()=>{
 assert.match(html,/showCoverage:false/);
 assert.match(html,/id="deliveryMapPanel" hidden/);
 assert.match(html,/id="confirmDeliveryMap"/);
 assert.match(html,/https:\/\/viacep\.com\.br\/ws\//);
 assert.match(html,/Entrega disponível! Taxa de entrega:/);
 assert.match(html,/Ainda não entregamos neste endereço/);
 assert.match(html,/Editar endereço/);
 assert.match(html,/pitacco_v2_customer_profile/);
});
