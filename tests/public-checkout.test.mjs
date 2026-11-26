// Lightweight contract tests for public checkout markup. Run: node --test tests/public-checkout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');
test('checkout uses a stable idempotency request key and backend RPC',()=>{
 assert.match(html,/p_request:routeMode\?deliveryQuote\.requestId:crypto\.randomUUID\(\)/);
 assert.match(html,/if\(!pendingRequest\)/);
 assert.match(html,/pitacco_checkout_geocoded_order/);
 assert.match(html,/client\.rpc\(priced\?'pitacco_confirm_priced_public_checkout':endpoint,priced\?/);
 assert.match(html,/pendingRequest\.p_expected_cents=Math\.round\(v2TotalToPay\(\)\*100\)/);
 assert.match(html,/pendingRequest\.p_price_revision=rule\.revision/);
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
 assert.doesNotMatch(html,/pitacco_public_store_region|v2HeroLocation/);
 assert.match(html,/const \[prepared\]=await Promise\.all\(\[prepareMenuStartup\(\),warmMenuStartupImages\(\)\]\)/);
 assert.match(html,/applyMenuStartupData\(prepared\)/);
 assert.match(html,/await waitForMenuIdentityPaint\(\)/);
 assert.match(html,/initOptions\(\);\s*await waitForMenuIdentityPaint\(\)/);
 assert.match(html,/\$\('menuStartup'\)\.hidden=true/);
 assert.doesNotMatch(html,/renderCategories\(\);renderProducts\(\);void loadLoyalty\(\)/);
 assert.match(html,/cartRestoreWarning/);
});

test('todas as lojas e templates mostram a foto inteira sem recorte automático',()=>{
 assert.doesNotMatch(html,/menuPhotoPilot|data-menu-photo-pilot|brendi-linho/);
 assert.doesNotMatch(html,/data-photo-fit="cover"|ratio>=\.96/);
 assert.match(html,/body\[data-menu-template="pitacco-v2"\]\[data-menu-skin="principal"\]/);
 assert.match(html,/\.category-grid \.product-visual\{\s*width:100%;height:clamp\(176px,21vw,270px\)/);
 assert.match(html,/height:auto;aspect-ratio:1 \/ 1/);
 assert.match(html,/object-fit:contain;object-position:center;box-sizing:border-box/);
 assert.match(html,/\.product-intro>img\{\s*display:block;width:100%;height:min\(72vw,350px\)/);
 assert.match(html,/function setProductPhotoFit\(photo\)\{[\s\S]*?photo\.dataset\.photoFit='contain'/);
 assert.match(html,/photo\.style\.setProperty\('object-fit','contain','important'\)/);
 assert.match(html,/setProductPhotoFit\(img\);img\.src=product\.image_url/);
 assert.match(html,/setProductPhotoFit\(photo\);\s*photo\.src=url/);
 assert.match(html,/setProductPhotoFit\(picture\);picture\.src=matching\.image_url/);
 assert.match(html,/setProductPhotoFit\(\$\('v2HeroImage'\)\)/);
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

test('changed payment price requires explicit customer reconfirmation and updates all templates',()=>{
 assert.match(html,/if\(menu&&!v2Only\(\)\)renderCart\(\)/);
 assert.match(html,/if\(!pendingRequest&&\/Preço por pagamento atualizado\//);
 assert.match(html,/client\.rpc\('pitacco_public_payment_price_rules',\{p_slug:slug\}\)/);
 assert.match(html,/menu\.store\.payment_price_rules=result\.data/);
 assert.match(html,/if\(v2Only\(\)\)v2ShowCheckoutStage\('payment'\)/);
 assert.match(html,/Confira o novo total e confirme novamente/);
});

test('option group navigation triggers only when maximum is newly reached',()=>{
 assert.match(html,/previousCount>=Number\(row.group.max\)\|\|row.selectedCount!==Number\(row.group.max\)/);
 assert.match(html,/groups\[groups.indexOf\(row\)\+1\]/);
 assert.match(html,/if\(!next\|\|!\$\('productDialog'\)\.open\)return/);
 assert.match(html,/if\(option&&input.checked\)advanceCompletedOptionGroup\(row,previousCount\)/);
 assert.match(html,/body.scrollTo\(\{top,behavior:reducedMotion\?'instant':'smooth'\}\)/);
});

test('public maps are bundled with Leaflet and the checkout keeps suggestions unconfirmed',()=>{
 const build=readFileSync(new URL('../scripts/build-cloudflare.sh',import.meta.url),'utf8');
 assert.match(build,/esbuild web\/deliveryMap\.mjs --bundle --format=esm/);
 assert.doesNotMatch(build,/cp web\/deliveryMap\.mjs/);
 assert.match(html,/href="\/assets\/delivery-map\.css"/);
 assert.match(html,/details\?\.requires_confirmation===true&&validDeliveryMapPoint\(details.suggested_point\)/);
 assert.match(html,/suggestedDeliveryPoint=\[\.\.\.details.suggested_point\]/);
 assert.match(html,/selectDeliveryPoint\(pendingMapPoint\);closeDeliveryMap\(\)/);
});

test('delivery service switching retains server options and ignores stale quote responses',()=>{
 assert.match(html,/if\(options!==undefined\)availableDeliveryServices=options/);
 assert.match(html,/deliveryQuote\.service===deliveryService/);
 assert.match(html,/v2QuotePendingGeneration===quoteGeneration/);
 assert.match(html,/selectedService!==deliveryService/);
 assert.match(html,/renderDeliveryServices\(\);renderCart\(\);\s*v2ScheduleDeliveryQuote\(true\)/);
 assert.match(html,/if\(token!==quoteGeneration\|\|selectedService!==deliveryService\)return false;\s*renderDeliveryServices\(\)/);
});

test('checkout places GPS after address fields, uses compact delivery radios and attaches cash change to cash choice',()=>{
 assert.ok(html.indexOf('id="addressExtra"')<html.indexOf('id="locateDelivery"'));
 assert.ok(html.indexOf('id="locateDelivery"')<html.indexOf('id="routeQuoteControls"'));
 assert.match(html,/#addressBlock #deliveryServices input\[type=radio\]\{[^}]*width:19px[^}]*box-shadow:none/);
 assert.match(html,/if\(option.value==='dinheiro'\)\{b.setAttribute\('aria-controls','v2ChangeBlock'\);change.dataset.paymentGroup=groupLabel;list.append\(change\)/);
});

test('Fideliza checkout uses a collapsible independent benefit card',()=>{
 assert.match(html,/id="loyaltyCardToggle"[^>]*aria-expanded="false"[^>]*aria-controls="loyaltyCardContent"/);
 assert.match(html,/id="loyaltyCardContent" hidden/);
 assert.match(html,/updateLoyaltyCard\(benefit\)/);
 assert.match(html,/\$\('loyaltyApply'\)\.disabled=fiado\|\|loyaltyBusy/);
 assert.match(html,/setLoyaltyCardExpanded\(true\);\$\('loyaltyBox'\)\.scrollIntoView/);
});

test('all storefront skins use the same checkout stages and premium loyalty card',()=>{
 assert.match(html,/const v2Only=\(\)=>\['classic','pitacco-v2'\]\.includes/);
 assert.match(html,/#cartDialog\[data-v2-stage=payment\] \.v2-checkout-panel--delivery/);
 assert.match(html,/id="loyaltyCardMetrics"/);
 assert.match(html,/id="loyaltyDetailsToggle"/);
 assert.match(html,/id="storeSocialLinks"[^>]*>[^<]*<\/div>\s*<\/header>/);
 assert.match(html,/link\.setAttribute\('aria-label',label\)/);
});

test('clean banner has no redundant navigation and gives the store logo prominence',()=>{
 assert.doesNotMatch(html,/id="v2Header(?:Back|Search|About|Cart)"/);
 assert.match(html,/#hero \.store-mark\{width:clamp\(94px,10vw,124px\)/);
 assert.match(html,/id="storeSocialLinks"/);
 assert.match(html,/id="openCart"/);
});

test('storefront section navigation stays visible on the home page',()=>{
 assert.doesNotMatch(html,/\[data-v2-page=inicio\]\s*#v2StoreNav\s*\{\s*display:none/);
});

test('principal hero uses the approved centered medallion without replacing store artwork',()=>{
 assert.match(html,/#hero \.identity\{\s*flex-direction:column;align-items:center;text-align:center/);
 assert.match(html,/#hero \.store-mark\{\s*width:clamp\(146px,17vw,190px\);height:clamp\(146px,17vw,190px\);border-radius:50%/);
 assert.match(html,/const value=studioAsset\(shop\.profile_logo_path\)\|\|shop\.logo_url/);
 assert.match(html,/#hero \.store-mark img\{\s*width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain/);
});

test('store-branded loading and bounded transient retry never expose raw database failures',()=>{
 assert.match(html,/id="menuStartupLogo"/);
 assert.match(html,/pitacco-public-brand:/);
 assert.match(html,/client\.rpc\('pitacco_public_menu_identity'/);
 assert.match(html,/attempt<3/);
 assert.match(html,/error\.code==='57014'/);
 assert.match(html,/id="menuStartupRetry"/);
 assert.doesNotMatch(html,/msg\('Cardápio indisponível: '\+\(err/);
 const refresh=html.slice(html.indexOf('async function refreshPublicStoreIdentity()'),html.indexOf('async function fetchPublicMenuWithRetry()'));
 assert.doesNotMatch(refresh,/client\.rpc\('get_public_menu'/);
});

test('merchant logo crop applies to the original image and preview',()=>{
 assert.match(html,/function applyLogoFrame\(frame\)/);
 assert.match(html,/applyLogoFrame\(d\?\.logo_frame\)/);
 assert.match(html,/img\.style\.objectFit=frame\.fit==='cover'\?'cover':'contain'/);
 assert.match(html,/img\.style\.transform='translate\('/);
});

test('home does not overlap navigation or duplicate categories',()=>{
 assert.match(html,/#v2Home\{display:block;margin:0;position:relative;z-index:1\}/);
 assert.doesNotMatch(html,/#v2Home\{[^}]*margin(?:-top)?:-/);
 assert.match(html,/root\.hidden=categories\.length<2\|\|\(document\.body\.dataset\.menuTemplate==='pitacco-v2'&&v2Page==='inicio'\)/);
});
