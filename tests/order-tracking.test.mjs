import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../marketing/acompanhar.html',import.meta.url),'utf8');
test('tracking token requires canonical UUID format',()=>{
 assert.match(html,/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
 assert.match(html,/Link de acompanhamento inválido/);
});
test('rejected and cancelled orders do not show progress timeline',()=>{
 assert.match(html,/rejected=\['rejected','recusado','recusada'\]/);
 assert.match(html,/if\(!cancelled\)\{for\(let i=0;i<labels\.length/);
 assert.match(html,/Pedido recusado/);
 assert.match(html,/Pedido cancelado/);
});
test('pickup completed only after explicit collection',()=>{
 assert.match(html,/const collected=prep==='completed'/);
 assert.match(html,/current=collected\?4:/);
});
test('tracking refresh avoids overlapping requests and has a timer',()=>{
 assert.match(html,/if\(working\)return;working=true/);
 assert.match(html,/finally\{working=false\}/);
 assert.match(html,/setInterval\(refresh,15000\)/);
});
test('notification feature is guarded by browser support',()=>{
 assert.match(html,/'Notification'in window/);
 assert.match(html,/'serviceWorker'in navigator/);
});


const mapModule=readFileSync(new URL('../revisions/0.12/web/deliveryMap.mjs',import.meta.url),'utf8');
const nativeGps=readFileSync(new URL('../entregador/android-app/app/src/main/java/br/com/pitacco/entregador/CourierLocationService.java',import.meta.url),'utf8');
const privacySql=readFileSync(new URL('../supabase/migrations/20261114234147_pitacco_private_delivery_tracking.sql',import.meta.url),'utf8');
test('courier app, merchant and customer share one GPS backend without a public courier list',()=>{
 assert.match(nativeGps,/rpc\/pitacco_courier_background_gps_update/);
 assert.match(privacySql,/public\.courier_positions gps/);
 assert.match(privacySql,/delivery\.order_id=p_order/);
 assert.match(privacySql,/delivery\.status='retirada'/);
 assert.match(privacySql,/multiple_stops/);
 assert.match(privacySql,/round\(gps\.latitude::numeric,3\)/);
 assert.match(html,/client\.rpc\('pitacco_track_public_order',\{p_token:token\}\)/);
 assert.doesNotMatch(html,/\.from\(['"]courier_positions['"]\)/);
});
test('customer tracking mounts the same Leaflet module as the merchant and hides stale positions',()=>{
 assert.match(mapModule,/export async function mountCustomerTrackingMap\(container\)/);
 assert.match(mapModule,/L\.tileLayer\('https:\/\/tile\.openstreetmap\.org/);
 assert.match(html,/import\('\/assets\/delivery-map\.mjs'\)/);
 assert.match(html,/id="courierLiveMap"/);
 assert.match(html,/Date\.now\(\)-lastTime<=90000/);
 assert.match(html,/showCourierMap\(null\)/);
 assert.match(html,/position\?\.state==='multiple_stops'/);
 assert.match(html,/renderLocation\(d\.courier_position\)/);
 assert.match(html,/if\(document\.visibilityState==='visible'\)/);
});


test('customer tracking exposes actual merchant-configured delivery PIN of 4 to 8 digits',()=>{
 const html=readFileSync(new URL('../marketing/acompanhar.html',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../supabase/migrations/20261122185000_store_delivery_code_digits_ifood_four.sql',import.meta.url),'utf8');
 assert.match(html,/const pinVisible=\/\^\[0-9\]\{4,8\}\$\/\.test\(pin\)/);
 assert.match(html,/deliveryPinCard'\)\.hidden=!pinVisible/);
 assert.match(html,/deliveryPin'\)\.textContent=pinVisible\?pin:''/);
 assert.match(sql,/digits smallint not null default 6 check \(digits between 4 and 8\)/);
 assert.match(html,/setInterval\(refresh,15000\)/);
});

 test('pickup ready is displayed to the customer and only explicit completion finishes it',()=>{
 assert.match(html,/const collected=prep==='completed';current=collected\?4:prep==='ready'&&rawStatus==='accepted'\?3:/);
 assert.match(html,/Seu pedido está pronto e disponível para retirada na loja/);
 assert.match(html,/Seu pedido foi retirado e finalizado/);
 });

test('group tracking shows only approximate position and confirmed other arrival',()=>{assert.match(html,/position\?\.another_arrived/);assert.match(html,/approximate_radius_m:group\?1500:140/);assert.match(mapModule,/uncertainty.setRadius\(radius\)/);assert.match(html,/if\(!group\)link.href/);});
test('WhatsApp message is prepared from the token-scoped order',()=>{assert.match(html,/d\.customer_name/);assert.match(html,/d\.public_number/);assert.match(html,/encodeURIComponent\(text\)/);assert.match(html,/d\.store\?\.whatsapp/);});

test('storefront displays only configured social links',()=>{const menu=readFileSync(new URL('../marketing/cardapio.html',import.meta.url),'utf8');assert.match(menu,/shop\.instagram_url/);assert.match(menu,/shop\.facebook_url/);assert.match(menu,/social\.hidden=!social\.children\.length/);});
